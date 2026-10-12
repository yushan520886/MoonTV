/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { markUserActive, markUserOffline } from '@/lib/activity';
import { getAuthInfoFromCookie } from '@/lib/auth';

export const runtime = 'edge';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * 在线状态接口（**一次性上报**，不是定时心跳）
 *
 * 2026-10-12 调整：前端不再每 60 秒轮询。现在只有两种调用时机：
 *  1. 打开站点/App 的页面时上报一次上线（POST /api/heartbeat）
 *  2. 关闭最后一个标签页时上报下线（POST /api/heartbeat?offline=1，走 sendBeacon）
 *
 * 其余"保持在线"由真实操作驱动（登录成功 / 播放进度 / 收藏 / 搜索），
 * 都在服务端对应接口里顺带刷新，见 src/lib/activity.ts。
 *
 * 旧的定时心跳客户端仍可正常调用（会退化为"一次上报"），保持向后兼容。
 */
export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);

  // 下线上报：即使 cookie 已被清（退出登录）也应放行，故放宽判断
  const isOffline =
    request.nextUrl.searchParams.get('offline') === '1' ||
    request.nextUrl.searchParams.get('offline') === 'true';

  if (isOffline) {
    // 尽力而为：解析不出用户就当成功（sendBeacon 也无法处理错误）
    await markUserOffline(authInfo?.username);
    return NextResponse.json({ ok: true, offline: true }, { headers: NO_STORE });
  }

  if (!authInfo || !authInfo.username) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE }
    );
  }

  await markUserActive(authInfo.username, request);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
