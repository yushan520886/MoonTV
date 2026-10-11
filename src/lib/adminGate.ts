/**
 * 后台门禁（Admin Gate）
 *
 * 目的：给 /admin 后台再加一道**独立密码**。这样即使站点账号被分享出去
 * （比如给朋友的普通账号），对方也进不了后台。
 *
 * 启用方式：在 Cloudflare 控制台给项目添加环境变量 ADMIN_PASSWORD（生产环境），
 * 然后重新部署一次即生效；删除该变量即关闭门禁。
 * ⚠️ 密码不要写进代码 —— 这个仓库是公开的，写死等于公开。
 *
 * 工作方式：
 * - 中间件拦截 /api/admin/*：没有门禁 Cookie（或值不对）→ 403 { code: 'ADMIN_GATE' }
 * - /admin 页面拿到 403 后显示密码输入框，验证通过后种一个 httpOnly Cookie
 * - Cookie 里只存**哈希**，不存明文
 */

/** 门禁 Cookie 名 */
export const ADMIN_GATE_COOKIE = 'admin_gate';

/** 通过一次门禁后 30 天内免输 */
export const ADMIN_GATE_MAX_AGE = 60 * 60 * 24 * 30;

/** 计算门禁口令的哈希（SHA-256，十六进制） */
export async function adminGateHash(password: string): Promise<string> {
  const data = new TextEncoder().encode(`admin-gate:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
