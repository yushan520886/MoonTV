/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_GATE_COOKIE, adminGateHash } from '@/lib/adminGate';
import { getAuthInfoFromCookie } from '@/lib/auth';

/**
 * 后台登录/退出流程（本轮优化点）：
 * 1. 所有 /admin 页面请求都经过这里做**服务端**登录态校验，未登录直接 307 到登录页
 *    —— 仅靠前端显示密码框不算防护，直接输网址也必须被拦下。
 * 2. /api/admin/* 未登录返回 401 JSON（不重定向，避免客户端拿到 HTML 解析失败）。
 * 3. 后台相关响应一律 no-store：退出登录后按「后退 / 刷新」不会命中浏览器缓存的已登录页面。
 */

/** 是否后台相关路径（页面 + 接口） */
function isAdminArea(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/api/admin/')
  );
}

/** 禁止缓存（防「退出后按后退」看到缓存的已登录页面） */
function noStore(res: NextResponse): NextResponse {
  res.headers.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, max-age=0'
  );
  res.headers.set('Pragma', 'no-cache');
  return res;
}

/** 放行；后台区域额外加 no-store */
function pass(pathname: string): NextResponse {
  const res = NextResponse.next();
  return isAdminArea(pathname) ? noStore(res) : res;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ★ 后台门禁：设置了 ADMIN_PASSWORD 时，后台接口必须带门禁 Cookie。
  //   /admin 页面本身放行 —— 它是客户端渲染，通过站点登录后拿到 403 会自己显示密码输入框。
  //   /api/admin/gate 是「输入密码换 Cookie」的入口，必须放行，否则鸡生蛋。
  //   不设置 ADMIN_PASSWORD 则完全不影响现有行为。
  if (
    process.env.ADMIN_PASSWORD &&
    pathname.startsWith('/api/admin/') &&
    !pathname.startsWith('/api/admin/gate') &&
    request.cookies.get(ADMIN_GATE_COOKIE)?.value !==
      (await adminGateHash(process.env.ADMIN_PASSWORD))
  ) {
    return noStore(
      NextResponse.json(
        { error: '需要后台密码', code: 'ADMIN_GATE' },
        { status: 403 }
      )
    );
  }

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // 如果没有设置密码，直接放行
  if (storageType === 'localstorage' && !process.env.PASSWORD) {
    return pass(pathname);
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return redirectToLogin(request, pathname);
  }

  // localstorage模式：在middleware中完成验证
  if (storageType === 'localstorage') {
    if (!authInfo.password || authInfo.password !== process.env.PASSWORD) {
      return redirectToLogin(request, pathname);
    }
    return pass(pathname);
  }

  // 其他模式：只验证签名
  // 检查是否有用户名（非localStorage模式下密码不存储在cookie中）
  if (!authInfo.username || !authInfo.signature) {
    return redirectToLogin(request, pathname);
  }

  // 验证签名（如果存在）
  if (authInfo.signature) {
    const isValidSignature = await verifySignature(
      authInfo.username,
      authInfo.signature,
      process.env.PASSWORD || ''
    );

    // 签名验证通过即可
    if (isValidSignature) {
      return pass(pathname);
    }
  }

  // 签名验证失败或不存在签名
  return redirectToLogin(request, pathname);
}

// 验证签名
async function verifySignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  try {
    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 将十六进制字符串转换为Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    // 验证签名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData
    );
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

// 重定向到登录页面
function redirectToLogin(request: NextRequest, pathname: string): NextResponse {
  // ⚠️ API 请求绝不能重定向到登录页：
  // 客户端（手机 App / 前端）拿到的是 HTML，JSON 解析失败后会报出
  // 「获取收藏夹失败」这类完全误导性的错误，极难排查。
  // API 一律返回 401 JSON，让调用方能识别出「登录态失效」。
  if (pathname.startsWith('/api/')) {
    return noStore(
      NextResponse.json(
        { error: 'Unauthorized', message: '登录状态已失效，请重新登录' },
        { status: 401 }
      )
    );
  }

  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查询参数
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  // 302（临时）而非 301：避免浏览器永久缓存「后台 → 登录页」的跳转
  return noStore(NextResponse.redirect(loginUrl, 307));
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/login',
    '/api/login',
    '/api/register',
    '/api/logout',
    '/api/server-config',
    '/api/admin/gate', // 后台门禁：输密码换 Cookie 的入口，必须在登录之前可用
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置middleware匹配规则
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/detail|api/search|api/image-proxy|api/douban).*)',
  ],
};
