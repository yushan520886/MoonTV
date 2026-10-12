'use client';

import { usePathname } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useRef } from 'react';

const SiteContext = createContext<{ siteName: string; announcement?: string }>({
  // 默认值
  siteName: 'MoonTV',
  announcement:
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
});

export const useSite = () => useContext(SiteContext);

/**
 * 在线状态（2026-10-12 重构：**事件驱动，不再定时轮询**）
 *
 * 上线（前端负责）
 *   - 打开站点 / App 页面（进入可见状态时上报一次）
 *   - **站内换页**（App Router 的前端路由跳转，如首页→详情→播放）
 *     注：以前只在首次加载时上报一次，导致「进去只逛不播」的人 5 分钟后被误判离线，
 *     所以这里补上「换页即刷新」。仍然是一次性事件，没有定时器。
 * 上线（服务端负责，见 src/lib/activity.ts）
 *   - 登录成功 /api/login、播放进度 /api/playrecords、收藏 /api/favorites、搜索 /api/searchhistory
 * 下线
 *   - 关闭**最后一个**标签页 → sendBeacon 上报下线
 *   - 退出登录 → /api/logout 服务端清除
 *   - 兜底：超过后端窗口（当前 5 分钟）没有任何活动 → 视为离线
 *
 * 为什么不用定时器：以前每 60 秒发一次请求，既费额度、又会让"只是开着页面"被误判在线。
 * 现在只有真实的打开 / 换页 / 操作才算在线 —— 更准，也更省。
 */

/** 该路径下的停留是否算「在使用本站」（后台页、登录页不算） */
function isUsagePath(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return false;
  if (pathname === '/login' || pathname.startsWith('/login/')) return false;
  return true;
}

/** 多标签页计数用的 localStorage key（关闭最后一个标签页才上报离线） */
const TAB_COUNT_KEY = 'moontv_open_tabs';
/** 计数超过该时长未更新即视为陈旧（上次异常退出的残留），重置掉 */
const TAB_COUNT_STALE_MS = 10 * 60 * 1000;

function readTabs(): number {
  try {
    const raw = localStorage.getItem(TAB_COUNT_KEY);
    if (!raw) return 0;
    const obj = JSON.parse(raw) as { n?: number; ts?: number };
    if (typeof obj?.n !== 'number' || typeof obj?.ts !== 'number') return 0;
    if (Date.now() - obj.ts > TAB_COUNT_STALE_MS) return 0;
    return Math.max(0, obj.n);
  } catch {
    return 0;
  }
}

function writeTabs(n: number): void {
  try {
    localStorage.setItem(
      TAB_COUNT_KEY,
      JSON.stringify({ n: Math.max(0, n), ts: Date.now() })
    );
  } catch {
    // 隐私模式下 localStorage 可能不可用 —— 忽略即可
  }
}

export function SiteProvider({
  children,
  siteName,
  announcement,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
}) {
  const pathname = usePathname();
  const lastPathRef = useRef<string | null>(null);

  /** 上报一次「在使用本站」。三重门禁：已登录 + 前台可见 + 非后台/登录页。 */
  const reportOnline = () => {
    if (typeof document === 'undefined') return;
    if (!document.cookie.includes('auth=')) return;
    if (document.visibilityState !== 'visible') return;
    if (!isUsagePath(window.location.pathname)) return;
    fetch('/api/heartbeat', { method: 'POST', cache: 'no-store' }).catch(() => {
      // 网络异常忽略：后端兜底窗口仍会正常工作
    });
  };

  // ---------- 首次加载 + 每次站内换页 → 各上报一次（仍无定时器） ----------
  useEffect(() => {
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    reportOnline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.cookie.includes('auth=')) return;

    // 从后台切回前台 → 视为一次使用
    const onVisible = () => {
      if (document.visibilityState === 'visible') reportOnline();
    };
    document.addEventListener('visibilitychange', onVisible);

    // ---------- 下线：关闭最后一个标签页时上报 ----------
    writeTabs(readTabs() + 1);

    const onPageHide = () => {
      const remain = Math.max(0, readTabs() - 1);
      writeTabs(remain);
      if (remain > 0) return; // 还有别的标签页开着 → 仍算在线

      const url = '/api/heartbeat?offline=1';
      try {
        if (navigator.sendBeacon) {
          // sendBeacon 会带上 Cookie，且在页面卸载后仍能发出
          navigator.sendBeacon(url);
        } else {
          fetch(url, { method: 'POST', keepalive: true }).catch(() => {
            // 忽略：兜底窗口会处理
          });
        }
      } catch {
        // 忽略：兜底窗口会处理
      }
    };

    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SiteContext.Provider value={{ siteName, announcement }}>
      {children}
    </SiteContext.Provider>
  );
}
