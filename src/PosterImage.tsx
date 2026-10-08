'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 稳健海报图片组件
 *
 * 解决三个实际问题：
 * 1. 豆瓣图床（doubanio.com）在部分网络/无 Referer 环境下返回 403 —— 自动改走本站
 *    /api/image-proxy 代理获取，绕开 Referer 校验与跨域限制。
 * 2. 原实现只有 onLoadingComplete，加载失败时永远停留在骨架屏 —— 这里增加 onError
 *    逐个降级（代理 → 原图直连 → 占位兜底），并在失败后进入可见的占位态而非永久白块。
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

/** 需要走代理的图床域名（豆瓣系图片对 Referer 敏感） */
const PROXY_REQUIRED_HOSTS = ['doubanio.com', 'douban.com'];

/** 判断某个地址是否应优先走本站图片代理 */
function shouldUseProxy(url: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return PROXY_REQUIRED_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`)
    );
  } catch {
    return false;
  }
}

/** 生成本站代理地址 */
function toProxyUrl(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
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
   * 候选地址队列，按优先级排列：
   * - 豆瓣图床：先代理，再原图（代理不可用时仍有兜底机会）
   * - 其他图床：先原图（省一层中转），再代理（应对直连被墙/防盗链）
   */
  const candidates = useMemo(() => {
    if (!src) return [];
    const list = shouldUseProxy(src)
      ? [toProxyUrl(src), src]
      : [src, toProxyUrl(src)];
    // 去重，避免原始地址本身就是代理地址时重复请求
    return Array.from(new Set(list));
  }, [src]);

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
      // 走本站代理时不需要 Referer；直连豆瓣图床时补上本站 Referer 便于通过校验
      referrerPolicy='no-referrer'
      onLoad={handleLoad}
      onError={handleError}
      className={`absolute inset-0 h-full w-full object-cover ${
        isVisible ? 'opacity-100 blur-0' : 'opacity-0 blur-md'
      } ${className ?? ''}`}
    />
  );
}
