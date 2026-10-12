/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { getStorage } from '@/lib/db';

/**
 * 用户在线状态上报（服务端）
 *
 * 语义（2026-10-12 调整，替换原来的「前端每 60 秒定时心跳」）：
 *
 * **算「上线」的事件（全部是一次性的，没有定时器）**
 *  1. 登录成功          → /api/login 里直接记录（App 与网页共用该接口）
 *  2. 打开站点/App 页面  → 前台页面加载时上报一次（/api/heartbeat）
 *  3. 真实使用操作       → 播放进度 / 收藏 / 搜索历史 写入时顺带刷新
 *     （看片时播放器会周期性写进度，所以"正在看"自然是新鲜的）
 *
 * **算「下线」的事件**
 *  4. 退出登录           → /api/logout 里清除
 *  5. 关闭最后一个标签页  → 前端 sendBeacon 上报离线
 *  6. 兜底：超过 ONLINE_WINDOW_MS 没有任何上述事件 → 视为离线
 *     （应对 App 直接被杀、断网、崩溃等无法上报的情况）
 *
 * 这样既准确（事件驱动），又不产生周期性请求（省额度）。
 */

/** 客户端来源信息（UA / IP 仅用于后台展示） */
function clientMeta(request?: Request): { ua: string; ip: string } {
  if (!request) return { ua: '', ip: '' };
  return {
    ua: request.headers.get('user-agent') || '',
    ip:
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') ||
      '',
  };
}

/** 记录一次活动（上线 / 保持在线）。失败静默 —— 绝不影响主业务流程。 */
export async function markUserActive(
  userName: string | undefined,
  request?: Request
): Promise<void> {
  if (!userName) return;
  try {
    const storage: any = getStorage();
    const touch = storage?.touchUserActivity;
    // localstorage / redis 等实现没有该方法 → 静默跳过
    if (typeof touch !== 'function') return;
    const { ua, ip } = clientMeta(request);
    await touch.call(storage, userName, ua, ip);
  } catch (err) {
    console.error('Failed to mark user active:', err);
  }
}

/** 标记离线（退出登录 / 关闭页面）。失败静默。 */
export async function markUserOffline(
  userName: string | undefined
): Promise<void> {
  if (!userName) return;
  try {
    const storage: any = getStorage();
    const clear = storage?.clearUserActivity;
    if (typeof clear !== 'function') return;
    await clear.call(storage, userName);
  } catch (err) {
    console.error('Failed to mark user offline:', err);
  }
}
