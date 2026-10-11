'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_SORT,
  FILTER_ALL,
  FILTER_PAGE_SIZE,
  GENRE_OPTIONS,
  hasActiveFilter,
  KIND_OPTIONS,
  REGION_OPTIONS,
  SORT_OPTIONS,
  YEAR_OPTIONS,
} from '@/lib/categories';
import { DoubanItem, DoubanResult } from '@/lib/types';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

/** 旧接口（单个 tag）每页 25 条 */
const LEGACY_PAGE_SIZE = 25;

const SELECT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm text-gray-700 outline-none transition-colors hover:border-green-400 focus:border-green-500 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200';

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className='flex flex-col gap-1'>
      <span className='text-xs text-gray-500 dark:text-gray-400'>{label}</span>
      <select
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DoubanPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);

  const type = searchParams.get('type');
  const tag = searchParams.get('tag');
  const region = searchParams.get('region') ?? FILTER_ALL;
  const genre = searchParams.get('genre') ?? FILTER_ALL;
  const year = searchParams.get('year') ?? FILTER_ALL;
  const sort = searchParams.get('sort') ?? DEFAULT_SORT;

  /** 是否有地区 / 类型 / 年代条件；没有 tag 时也必须走分类筛选接口 */
  const useFilter = useMemo(
    () => hasActiveFilter({ region, genre, year }) || !tag,
    [region, genre, year, tag]
  );

  const pageLimit = useFilter ? FILTER_PAGE_SIZE : LEGACY_PAGE_SIZE;

  const buildRequestUrl = (page: number) => {
    if (useFilter) {
      const params = new URLSearchParams();
      params.set('type', type as string);
      if (region !== FILTER_ALL) params.set('region', region);
      if (genre !== FILTER_ALL) params.set('genre', genre);
      if (year !== FILTER_ALL) params.set('year', year);
      params.set('sort', sort);
      params.set('pageStart', String(page * FILTER_PAGE_SIZE));
      return `/api/douban?${params.toString()}`;
    }

    return `/api/douban?type=${type}&tag=${encodeURIComponent(
      tag as string
    )}&pageSize=${LEGACY_PAGE_SIZE}&pageStart=${page * LEGACY_PAGE_SIZE}`;
  };

  // 生成骨架屏数据
  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  useEffect(() => {
    if (!type) {
      setError('缺少必要参数: type');
      setLoading(false);
      return;
    }

    // 重置页面状态
    setDoubanData([]);
    setCurrentPage(0);
    setHasMore(true);
    setError(null);
    setIsLoadingMore(false);

    // 立即加载第一页数据
    const loadInitialData = async () => {
      try {
        setLoading(true);
        const response = await fetch(buildRequestUrl(0));

        if (!response.ok) {
          throw new Error('获取豆瓣数据失败');
        }

        const data: DoubanResult = await response.json();

        if (data.code === 200) {
          setDoubanData(data.list);
          setHasMore(data.list.length >= pageLimit);
        } else {
          throw new Error(data.message || '获取数据失败');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取豆瓣数据失败');
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, tag, region, genre, year, sort, useFilter, pageLimit]);

  // 单独处理 currentPage 变化（加载更多）
  useEffect(() => {
    if (currentPage > 0 && type) {
      const fetchMoreData = async () => {
        try {
          setIsLoadingMore(true);

          const response = await fetch(buildRequestUrl(currentPage));

          if (!response.ok) {
            throw new Error('获取豆瓣数据失败');
          }

          const data: DoubanResult = await response.json();

          if (data.code === 200) {
            setDoubanData((prev) => [...prev, ...data.list]);
            setHasMore(data.list.length >= pageLimit);
          } else {
            throw new Error(data.message || '获取数据失败');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : '获取豆瓣数据失败');
        } finally {
          setIsLoadingMore(false);
        }
      };

      fetchMoreData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // 设置滚动监听
  useEffect(() => {
    // 如果没有更多数据或正在加载，则不设置监听
    if (!hasMore || isLoadingMore || loading) {
      return;
    }

    // 确保 loadingRef 存在
    if (!loadingRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadingRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, isLoadingMore, loading]);

  /** 改筛选条件 → 写回 URL（保持与既有 ?type=&tag= 机制一致，可分享、可前进后退） */
  const applyFilter = (patch: Record<string, string>) => {
    const params = new URLSearchParams();

    params.set('type', patch.type ?? type ?? 'movie');

    const nextRegion = patch.region ?? region;
    const nextGenre = patch.genre ?? genre;
    const nextYear = patch.year ?? year;
    const nextSort = patch.sort ?? sort;

    // 只有「当前没有任何筛选」且走的是旧 tag 链接时，才保留 tag
    const keepTag =
      !hasActiveFilter({
        region: nextRegion,
        genre: nextGenre,
        year: nextYear,
      }) && tag;

    if (keepTag) {
      params.set('tag', tag as string);
    } else {
      if (nextRegion !== FILTER_ALL) params.set('region', nextRegion);
      if (nextGenre !== FILTER_ALL) params.set('genre', nextGenre);
      if (nextYear !== FILTER_ALL) params.set('year', nextYear);
      params.set('sort', nextSort);
    }

    params.set('title', getPageTitle(patch));
    router.push(`/douban?${params.toString()}`);
  };

  const resetFilters = () => {
    const params = new URLSearchParams();
    params.set('type', type ?? 'movie');
    params.set('sort', DEFAULT_SORT);
    params.set('title', type === 'tv' ? '剧集筛选' : '分类筛选');
    router.push(`/douban?${params.toString()}`);
  };

  /** 标题：优先用 URL 里的 title，否则按条件拼 */
  function getPageTitle(patch: Record<string, string> = {}) {
    const titleParam = searchParams.get('title');
    if (titleParam && Object.keys(patch).length === 0) {
      return titleParam;
    }

    const nextType = patch.type ?? type ?? 'movie';
    const nextRegion = patch.region ?? region;
    const nextGenre = patch.genre ?? genre;
    const nextYear = patch.year ?? year;

    const kindLabel =
      KIND_OPTIONS.find((item) => item.value === nextType)?.label ?? '电影';

    const parts = [nextRegion, nextGenre, nextYear]
      .filter((item) => item && item !== FILTER_ALL)
      .join(' · ');

    return parts ? `${kindLabel} · ${parts}` : `${kindLabel}筛选`;
  }

  const activeFilterCount = [region, genre, year].filter(
    (item) => item !== FILTER_ALL
  ).length;

  const filterBar = (
    <div className='mb-6 rounded-xl border border-gray-200/70 bg-white/50 p-4 backdrop-blur-sm dark:border-gray-700/50 dark:bg-gray-900/40'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
        <FilterSelect
          label='内容'
          value={type ?? 'movie'}
          options={KIND_OPTIONS}
          onChange={(value) => applyFilter({ type: value })}
        />
        <FilterSelect
          label='地区'
          value={region}
          options={REGION_OPTIONS}
          onChange={(value) => applyFilter({ region: value })}
        />
        <FilterSelect
          label='类型'
          value={genre}
          options={GENRE_OPTIONS}
          onChange={(value) => applyFilter({ genre: value })}
        />
        <FilterSelect
          label='年代'
          value={year}
          options={YEAR_OPTIONS}
          onChange={(value) => applyFilter({ year: value })}
        />
        <FilterSelect
          label='排序'
          value={sort}
          options={SORT_OPTIONS}
          onChange={(value) => applyFilter({ sort: value })}
        />
      </div>

      <div className='mt-3 flex items-center justify-between'>
        <span className='text-xs text-gray-500 dark:text-gray-400'>
          {activeFilterCount > 0
            ? `已选 ${activeFilterCount} 个筛选条件，结果实时联动`
            : '地区 / 类型 / 年代可任意组合'}
        </span>
        {activeFilterCount > 0 && (
          <button
            onClick={resetFilters}
            className='text-xs text-gray-500 underline-offset-2 hover:text-green-600 hover:underline dark:text-gray-400 dark:hover:text-green-400'
          >
            重置筛选
          </button>
        )}
      </div>
    </div>
  );

  const getActivePath = () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (tag) params.set('tag', tag);
    const titleParam = searchParams.get('title');
    if (titleParam) params.set('title', titleParam);

    const queryString = params.toString();
    const activePath = `/douban${queryString ? `?${queryString}` : ''}`;
    return activePath;
  };

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 页面标题 */}
        <div className='mb-6'>
          <h1 className='text-3xl font-bold text-gray-800 mb-2 dark:text-gray-200'>
            {getPageTitle()}
          </h1>
          <p className='text-gray-600 dark:text-gray-400'>来自豆瓣的精选内容</p>
        </div>

        {/* 分类筛选栏 */}
        {type && filterBar}

        {/* 内容展示区域 */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
          {error ? (
            <div className='flex justify-center items-center h-40'>
              <div className='text-red-500 text-center'>
                <div className='text-lg font-semibold mb-2'>加载失败</div>
                <div className='text-sm'>{error}</div>
              </div>
            </div>
          ) : (
            <>
              {/* 内容网格 */}
              <div className='grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
                {loading
                  ? // 显示骨架屏
                    skeletonData.map((index) => (
                      <DoubanCardSkeleton key={index} />
                    ))
                  : // 显示实际数据
                    doubanData.map((item, index) => (
                      <div key={`${item.title}-${index}`} className='w-full'>
                        <VideoCard
                          from='douban'
                          title={item.title}
                          poster={item.poster}
                          douban_id={item.id}
                          rate={item.rate}
                        />
                      </div>
                    ))}
              </div>

              {/* 加载更多指示器 */}
              {hasMore && !loading && (
                <div
                  ref={(el) => {
                    if (el && el.offsetParent !== null) {
                      (
                        loadingRef as React.MutableRefObject<HTMLDivElement | null>
                      ).current = el;
                    }
                  }}
                  className='flex justify-center mt-12 py-8'
                >
                  {isLoadingMore && (
                    <div className='flex items-center gap-2'>
                      <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                      <span className='text-gray-600'>加载中...</span>
                    </div>
                  )}
                </div>
              )}

              {/* 没有更多数据提示 */}
              {!hasMore && doubanData.length > 0 && (
                <div className='text-center text-gray-500 py-8'>
                  已加载全部内容
                </div>
              )}

              {/* 空状态 */}
              {!loading && doubanData.length === 0 && !error && (
                <div className='text-center text-gray-500 py-8'>
                  暂无相关内容，换个筛选条件试试
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense>
      <DoubanPageClient />
    </Suspense>
  );
}
