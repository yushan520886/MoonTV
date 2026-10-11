/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';

export const runtime = 'edge';

/**
 * 心跳接口
 *
 * 前端每隔一段时间调用一次，用于后台统计「谁在线」。
 * - 未登录 → 401（前端收到 401 会停止心跳）
 * - 非 d1 存储（如 redis / localstorage）没有该方法 → 直接当作成功返回，不影响使用
 *
 * 响应体极小，且必须 no-store（不要被缓存）。
 */
export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const storage: any = getStorage();
  const touch = storage?.touchUserActivity;

  if (typeof touch !== 'function') {
    // 存储实现不支持在线状态，静默成功
    return NextResponse.json(
      { ok: true, skipped: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const ua = request.headers.get('user-agent') || '';
    const ip =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') ||
      '';
    await touch.call(storage, authInfo.username, ua, ip);
    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('心跳写入失败:', err);
    // 心跳失败不影响主流程
    return NextResponse.json(
      { ok: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
