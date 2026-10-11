import { NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * 图片代理（OrionTV / 网页端兼容接口）
 *
 * 作用：服务端补上 Referer 后取图，绕开豆瓣图床的防盗链（无 Referer 会 418）。
 *
 * 缓存策略（两层）：
 * - 边缘缓存（Cache API）：同一张图全网只回源一次，后续请求由 Cloudflare 边缘直接返回。
 * 注意：Pages Functions 的响应**不会**被 CDN 自动缓存，必须显式使用 Cache API。
 * - 浏览器缓存：海报地址是内容寻址的（如 p2933860063.jpg），可长期缓存。
 *
 * 健壮性：任何缓存操作都不得影响出图 —— 全部 try/catch 包裹，失败就退化为直连。
 */

/** 浏览器缓存时长：30 天（海报 URL 内容寻址，重复访问不再产生请求） */
const BROWSER_MAX_AGE = 60 * 60 * 24 * 30;

/** 边缘缓存时长：30 天（通过响应头 Cache-Control 决定 Cache API 条目的 TTL） */
const EDGE_MAX_AGE = 60 * 60 * 24 * 30;

const UPSTREAM_HEADERS = {
  Referer: 'https://movie.douban.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

/** 取得 Cloudflare 边缘缓存对象（本地 / 非 CF 环境不存在，返回 undefined） */
function getEdgeCache(): Cache | undefined {
  try {
    const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return c?.default;
  } catch {
    return undefined;
  }
}

/** 只按 url 参数构造缓存键，避免其他查询参数把缓存打散 */
function buildCacheKey(request: Request, imageUrl: string): Request {
  const key = new URL(request.url);
  key.search = `?url=${encodeURIComponent(imageUrl)}`;
  return new Request(key.toString(), { method: 'GET' });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  const cache = getEdgeCache();
  const cacheKey = buildCacheKey(request, imageUrl);

  // ① 命中边缘缓存 —— 直接返回，不再回源
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const headers = new Headers(hit.headers);
        headers.set('X-Image-Cache', 'HIT');
        return new Response(hit.body, { status: 200, headers });
      }
    } catch {
      // 缓存读取失败不影响出图，继续走回源
    }
  }

  try {
    const imageResponse = await fetch(imageUrl, { headers: UPSTREAM_HEADERS });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status }
      );
    }

    const contentType = imageResponse.headers.get('content-type');

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 }
      );
    }

    const headers = new Headers();
    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    headers.set(
      'Cache-Control',
      `public, max-age=${BROWSER_MAX_AGE}, s-maxage=${EDGE_MAX_AGE}, immutable`
    );
    headers.set('X-Image-Cache', 'MISS');

    const response = new Response(imageResponse.body, {
      status: 200,
      headers,
    });

    // ② 写入边缘缓存（clone 出来存，原响应继续返回给客户端）
    if (cache) {
      try {
        await cache.put(cacheKey, response.clone());
      } catch {
        // 缓存写入失败不影响出图
      }
    }

    return response;
  } catch {
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 500 }
    );
  }
}
