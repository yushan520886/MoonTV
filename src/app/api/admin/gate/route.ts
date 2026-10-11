import { NextRequest, NextResponse } from 'next/server';

import {
  ADMIN_GATE_COOKIE,
  ADMIN_GATE_MAX_AGE,
  adminGateHash,
} from '@/lib/adminGate';

export const runtime = 'edge';

/**
 * 后台门禁：校验独立密码，通过后种一个 httpOnly Cookie（只存哈希）。
 *
 * 未设置 ADMIN_PASSWORD 时视为未启用门禁：直接返回成功、不种 Cookie，
 * 中间件也不会拦截 /api/admin/*。
 */
export async function POST(request: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let password = '';
  try {
    const body = (await request.json()) as { password?: string };
    password = String(body?.password ?? '');
  } catch {
    // 留空走下面的统一校验
  }

  if (!password || password !== expected) {
    return NextResponse.json({ error: '后台密码错误' }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_GATE_COOKIE, await adminGateHash(expected), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_GATE_MAX_AGE,
  });
  return res;
}
