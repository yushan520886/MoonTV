import { NextResponse } from 'next/server';

import {
  buildDoubanTags,
  hasActiveFilter,
  normalizeSort,
} from '@/lib/categories';
import { getCacheTime } from '@/lib/config';
import { DoubanItem, DoubanResult } from '@/lib/types';

/** 允许的 type。movie / tv 是原有链接在用的，variety / anime 供分类筛选使用 */
const ALLOWED_TYPES = ['movie', 'tv', 'variety', 'anime'];

const REQUEST_TIMEOUT_MS = 15000;
/** 豆瓣偶发返回空列表（实测限流可持续数十秒），重试一次能明显提高成功率 */
const RETRY_DELAY_MS = 600;

const DOUBAN_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Referer: 'https://movie.douban.com/',
  Accept: 'application/json, text/plain, */*',
};

interface DoubanSearchSubjectsResponse {
  subjects: Array<{ id: string; title: string; cover: string; rate: string }>;
}

interface DoubanNewSearchResponse {
  data?: Array<{ id: string; title: string; cover?: string; rate?: string }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchDoubanJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: DOUBAN_HEADERS,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toPoster(cover?: string): string {
  if (!cover) return '';
  // 豆瓣偶尔返回 http 图片，浏览器在 https 页面下会拦截
  return cover.replace(/^http:/, 'https:');
}

/**
 * 旧路径：单个 tag 的推荐列表。
 *
 * **保持原样不动**，站点侧边栏 / 首页「热门」「Top250」「美剧」「韩剧」等既有链接
 * 全都走这里，行为必须与改造前完全一致。
 */
async function handleSingleTag(
  type: string,
  tag: string,
  pageSize: number,
  pageStart: number
) {
  const target = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${tag}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart}`;

  const doubanData = await fetchDoubanJson<DoubanSearchSubjectsResponse>(target);

  const list: DoubanItem[] = doubanData.subjects.map((item) => ({
    id: item.id,
    title: item.title,
    poster: toPoster(item.cover),
    rate: item.rate,
  }));

  return list;
}

/**
 * 新路径：支持「地区 + 类型 + 年代」多条件联动。
 *
 * 豆瓣的 `new_search_subjects` 支持 `tags` 逗号拼接（如 `电影,泰国,喜剧`），
 * 这才是真正能联动的接口；`search_subjects` 只吃一个 tag，做不到组合。
 */
async function handleFilters(params: {
  kind: string;
  region?: string | null;
  genre?: string | null;
  year?: string | null;
  sort?: string | null;
  pageStart: number;
}) {
  const tags = buildDoubanTags({
    kind: params.kind,
    region: params.region,
    genre: params.genre,
    year: params.year,
  });
  const sort = normalizeSort(params.sort);

  const target = `https://movie.douban.com/j/new_search_subjects?sort=${sort}&range=0,10&tags=${encodeURIComponent(
    tags
  )}&start=${params.pageStart}`;

  let list: DoubanItem[] = [];

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const doubanData = await fetchDoubanJson<DoubanNewSearchResponse>(target);
    const data = doubanData.data ?? [];

    list = data.map((item) => ({
      id: item.id,
      title: item.title,
      poster: toPoster(item.cover),
      rate: item.rate ?? '',
    }));

    // 豆瓣被限流时会返回 200 + 空数组，隔一会儿再试一次
    if (list.length > 0) break;
    if (attempt === 0) await sleep(RETRY_DELAY_MS);
  }

  return list;
}

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const type = searchParams.get('type');
  const tag = searchParams.get('tag');
  const region = searchParams.get('region');
  const genre = searchParams.get('genre');
  const year = searchParams.get('year');
  const sort = searchParams.get('sort');
  const pageSize = parseInt(searchParams.get('pageSize') || '16');
  const pageStart = parseInt(searchParams.get('pageStart') || '0');

  // 验证参数
  if (!type) {
    return NextResponse.json({ error: '缺少必要参数: type' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type 参数必须是 ${ALLOWED_TYPES.join(' / ')}` },
      { status: 400 }
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 }
    );
  }

  const filterParams = { region, genre, year };

  // 「分类筛选」模式：带了地区 / 类型 / 年代，或者压根没有 tag（新的导航入口）时，
  // 一律走支持多条件联动的接口
  const useFilter = hasActiveFilter(filterParams) || !tag;

  if (!useFilter) {
    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: 'pageSize 必须在 1-100 之间' },
        { status: 400 }
      );
    }

    if (tag === 'top250') {
      return handleTop250(pageStart);
    }
  }

  try {
    const list = useFilter
      ? await handleFilters({
          kind: type,
          region,
          genre,
          year,
          sort,
          pageStart,
        })
      : await handleSingleTag(type, tag as string, pageSize, pageStart);

    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list,
    };

    // getCacheTime 是异步的，漏掉 await 会写出 `max-age=[object Promise]`
    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}

function handleTop250(pageStart: number) {
  const target = `https://movie.douban.com/top250?start=${pageStart}&filter=`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent': DOUBAN_HEADERS['User-Agent'],
      Referer: 'https://movie.douban.com/',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  };

  return fetch(target, fetchOptions)
    .then(async (fetchResponse) => {
      clearTimeout(timeoutId);

      if (!fetchResponse.ok) {
        throw new Error(`HTTP error! Status: ${fetchResponse.status}`);
      }

      // 获取 HTML 内容
      const html = await fetchResponse.text();

      // 通过正则同时捕获影片 id、标题、封面以及评分
      const moviePattern =
        /<div class="item">[\s\S]*?<a[^>]+href="https?:\/\/movie\.douban\.com\/subject\/(\d+)\/"[\s\S]*?<img[^>]+alt="([^"]+)"[^>]*src="([^"]+)"[\s\S]*?<span class="rating_num"[^>]*>([^<]*)<\/span>[\s\S]*?<\/div>/g;
      const movies: DoubanItem[] = [];
      let match;

      while ((match = moviePattern.exec(html)) !== null) {
        const id = match[1];
        const title = match[2];
        const cover = match[3];
        const rate = match[4] || '';

        movies.push({
          id: id,
          title: title,
          poster: toPoster(cover),
          rate: rate,
        });
      }

      const apiResponse: DoubanResult = {
        code: 200,
        message: '获取成功',
        list: movies,
      };

      const cacheTime = await getCacheTime();
      return NextResponse.json(apiResponse, {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}`,
        },
      });
    })
    .catch((error) => {
      clearTimeout(timeoutId);
      return NextResponse.json(
        {
          error: '获取豆瓣 Top250 数据失败',
          details: (error as Error).message,
        },
        { status: 500 }
      );
    });
}
