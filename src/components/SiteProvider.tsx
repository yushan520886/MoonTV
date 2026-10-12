'use client';

import { createContext, ReactNode, useContext, useEffect } from 'react';

const SiteContext = createContext<{ siteName: string; announcement?: string }>({
  // 默认值
  siteName: 'MoonTV',
  announcement:
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
});

export const useSite = () => useContext(SiteContext);

/** 心跳间隔（毫秒）。60 秒足够判断"在线"，也不会明显消耗请求额度。 */
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export function SiteProvider({
  children,
  siteName,
  announcement,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
}) {
  /**
   * 心跳：让后台能统计「谁在线」。
   * - 只在已登录（存在 auth cookie）时启动，登录页不会白白发请求；
   * - 只在页面可见时发送（切到后台 / 锁屏自动跳过）；
   * - 收到 401（未登录/会话失效）立即停止，不再骚扰服务端。
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.cookie.includes('auth=')) return;

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const beat = async () => {
      if (stopped) return;
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/heartbeat', {
          method: 'POST',
          cache: 'no-store',
        });
        if (res.status === 401) {
          stopped = true;
          if (timer) clearInterval(timer);
        }
      } catch {
        // 网络异常忽略，下一轮再试
      }
    };

    beat();
    timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <SiteContext.Provider value={{ siteName, announcement }}>
      {children}
    </SiteContext.Provider>
  );
}
