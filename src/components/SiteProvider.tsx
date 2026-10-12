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

/**
 * 该路径下的停留是否算「在使用本站」。
 *
 * 后台管理页（/admin）**不算** —— 只有在前台看片 / 搜索（含手机 App 走的是同样的接口）
 * 才算在线。否则"进后台看了看设置"会被误判成在线，导致在线人数虚高。
 * 登录页同样不计（本来就还没登录）。
 */
function isUsagePath(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return false;
  if (pathname === '/login' || pathname.startsWith('/login/')) return false;
  return true;
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
  /**
   * 心跳：让后台能统计「谁在线」。
   * - 只在已登录（存在 auth cookie）时才有意义；登录页 / 后台页不发；
   * - 每一拍都重新读当前路径 —— 用户在同一个标签页里从后台切回前台后，
   *   无需重新挂载组件就会自动恢复心跳；
   * - 只在页面可见时发送（切到后台 / 锁屏自动跳过）；
   * - 收到 401（未登录 / 会话失效）或 auth cookie 消失（已退出登录）立即停止。
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.cookie.includes('auth=')) return;

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };

    const beat = async () => {
      if (stopped) return;
      // 已退出登录（cookie 被清）：停止，避免继续被算作在线
      if (!document.cookie.includes('auth=')) {
        stop();
        return;
      }
      // 后台 / 登录页不算使用
      if (!isUsagePath(window.location.pathname)) return;
      // 页面不可见（切标签页、锁屏）跳过
      if (document.visibilityState !== 'visible') return;

      try {
        const res = await fetch('/api/heartbeat', {
          method: 'POST',
          cache: 'no-store',
        });
        if (res.status === 401) {
          stop();
        }
      } catch {
        // 网络异常忽略，下一轮再试
      }
    };

    beat();
    timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    return () => stop();
  }, []);

  return (
    <SiteContext.Provider value={{ siteName, announcement }}>
      {children}
    </SiteContext.Provider>
  );
}
