'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getPosterCandidates } from '@/lib/imageProxy';

/**
 * 稳健海报图片组件
 *
 * 解决三个实际问题：
 * 1. 豆瓣图床（img*.doubanio.com）会校验 Referer —— 无 Referer 时直接 418，
 *    图片加载失败留下空白/灰块。这里走 imageProxy 提供的候选链逐级降级：
 *    本站 /api/image-proxy 代理 → 原图。
 * 2. 原实现只有 onLoadingComplete，加载失败时永远停留在骨架屏 —— 这里增加 onError
 *    逐个降级，并在全部失败后进入可见的占位态而非永久白块。
 * 3. Selene 等 WebView 对 next/image 的优化链路兼容性差 —— 统一改用原生 img，
 *    减少一层代理，加载路径更短更可靠。
 */

interface PosterImageProps {
  /** 海报原始地址 */
  src?: string;
  /** 无障碍描述 */
  alt?: string;
  /** 额外 className，用于控制淡入/模糊等过渡效果 */
  className?: string;
  /** 图片可见后回调（无论成功或已兜底），用于关闭外层骨架屏 */
  onSettled?: () => void;
}

export default function PosterImage({
  src = '',
  alt = '',
  className = '',
  onSettled,
}: PosterImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const settledRef = useRef(false);

  /**
   * 候选地址队列，按优先级排列（由 imageProxy 统一给出）：
   * - 豆瓣图床：本站代理 → 原图
   * - 其他图床：原图 → 本站代理（应对直连被墙/防盗链）
   */
  const candidates = useMemo(() => getPosterCandidates(src), [src]);

  const currentSrc = candidates[attempt] ?? '';

  // 源变化时重置状态，避免复用上一个视频的加载结果
  useEffect(() => {
    setAttempt(0);
    setLoadedSrc(null);
    setFailed(false);
    settledRef.current = false;
  }, [src]);

  const handleLoad = useCallback(() => {
    setLoadedSrc(currentSrc);
    if (!settledRef.current) {
      settledRef.current = true;
      onSettled?.();
    }
  }, [currentSrc, onSettled]);

  const handleError = useCallback(() => {
    setAttempt((prev) => {
      const next = prev + 1;
      // 候选用尽 —— 标记失败并解除骨架屏，避免永久白块
      if (next >= candidates.length) {
        setFailed(true);
        if (!settledRef.current) {
          settledRef.current = true;
          onSettled?.();
        }
        return prev;
      }
      return next;
    });
  }, [candidates.length, onSettled]);

  const isVisible = !!loadedSrc && loadedSrc === currentSrc;

  // 全部候选失败：显示可见的兜底占位，而不是留白
  if (failed || (!currentSrc && !src)) {
    return (
      <div
        className={`absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-800 ${
          className ?? ''
        }`}
      >
        <span className='px-2 text-center text-[10px] leading-tight text-gray-400 dark:text-gray-500 line-clamp-3'>
          {alt || '暂无图片'}
        </span>
      </div>
    );
  }

  if (!currentSrc) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={currentSrc}
      alt={alt}
      loading='lazy'
      decoding='async'
      // 本站代理会自带 Referer；原图兜底时本就会失败，故统一不带
      referrerPolicy='no-referrer'
      onLoad={handleLoad}
      onError={handleError}
      className={`absolute inset-0 h-full w-full object-cover ${
        isVisible ? 'opacity-100 blur-0' : 'opacity-0 blur-md'
      } ${className ?? ''}`}
    />
  );
}
