/**
 * 图片地址处理工具
 *
 * 背景：豆瓣图床（img*.doubanio.com）会校验 Referer —— 无 Referer 或来源异常时
 * 直接返回 418（I'm a teapot），图片加载失败并留下空白/灰块。
 *
 * 解决顺序（逐级降级）：
 *   1. 本站 /api/image-proxy —— 服务端补 Referer 后取图，并做边缘缓存
 *      （同一张图全网只回源一次），会消耗 1 次 Functions 请求额度。
 *   2. 原图直连 —— 最后手段（多数情况下会 418，仅作兜底）。
 *
 * 备注：曾实测过「让浏览器直连第三方豆瓣镜像 CDN」的方案 —— 可完全绕开本站服务器、
 * 把海报请求降到 0 次，但那个镜像是第三方个人维护的反代，**已按用户要求取消**。
 * 若将来需要重新启用，实测数据与实现方式见技能库
 * `moontv-cloudflare-pages-deploy` 的 §17.2。
 */

/** 需要特殊处理的图床域名（豆瓣系对 Referer 敏感，直连会 418） */
export const PROXY_REQUIRED_HOSTS = ['doubanio.com', 'douban.com'];

/** 判断某个地址是否属于「需要特殊处理」的图床（豆瓣系） */
export function shouldUseImageProxy(url: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return PROXY_REQUIRED_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`)
    );
  } catch {
    return false;
  }
}

/** 生成本站代理地址 */
export function toImageProxyUrl(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

/**
 * 返回某张图片的候选地址队列（按优先级，由 PosterImage 逐级 onError 降级）。
 *
 * - 豆瓣图床：本站代理 → 原图
 * - 其他图床：原图 → 本站代理（直连被墙/防盗链时兜底）
 */
export function getPosterCandidates(url: string): string[] {
  if (!url) return [];

  if (shouldUseImageProxy(url)) {
    return Array.from(new Set([toImageProxyUrl(url), url]));
  }

  return Array.from(new Set([url, toImageProxyUrl(url)]));
}
