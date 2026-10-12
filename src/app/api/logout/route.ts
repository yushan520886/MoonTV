import { NextResponse } from 'next/server';

import { ADMIN_GATE_COOKIE } from '@/lib/adminGate';

export const runtime = 'edge';

/**
 * 退出登录
 *
 * 要求（后台登录/退出流程优化）：
 * 1. 一次性清除**全部**登录凭证 —— 站点会话 Cookie（auth）与后台门禁 Cookie（admin_gate）。
 *    只清 auth 会留下门禁 Cookie，同一浏览器上换个人仍能直接进后台，属于越权隐患。
 * 2. 响应禁止缓存，避免「退出后按后退 / 刷新」拿到浏览器缓存的已登录页面。
 * 3. 幂等：未登录时调用同样返回 200，前端可以无脑调用（重复退出不报错）。
 *
 * 注意：删除 Cookie 时必须与下发时的 name + path 一致（此处都是 path=/），
 * 否则浏览器不会删掉它。httpOnly / secure 属性不一致不影响删除。
 */

/** 需要一并清除的凭证 Cookie（含各自下发时的 httpOnly 属性，保持声明一致便于维护） */
const CLEAR_COOKIES: Array<{ name: string; httpOnly: boolean }> = [
  { name: 'auth', httpOnly: false }, // 站点会话（PWA 需要客户端可读，故非 httpOnly）
  { name: ADMIN_GATE_COOKIE, httpOnly: true }, // 后台门禁
];

export async function POST() {
  const response = NextResponse.json(
    { ok: true },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
      },
    }
  );

  for (const item of CLEAR_COOKIES) {
    response.cookies.set(item.name, '', {
      path: '/',
      expires: new Date(0), // 立即过期
      maxAge: 0, // 双保险：部分浏览器只认 max-age
      sameSite: 'lax',
      httpOnly: item.httpOnly,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  return response;
}
