/**
 * 图片代理工具
 *
 * 背景：豆瓣图床（*.doubanio.com）会校验 Referer —— 无 Referer 或来源异常时
 * 直接返回 418（I'm a teapot），图片加载失败并留下空白/灰块。
 * 这里把豆瓣系图片统一改写成本站 /api/image-proxy 代理地址，
 * 由服务端补上 Referer 后再取图，绕开防盗链。
 */

/** 需要走代理的图床域名（豆瓣系对 Referer 敏感） */
export const PROXY_REQUIRED_HOSTS = ['doubanio.com', 'douban.com'];

/** 判断某个地址是否应优先走本站图片代理 */
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

/** 需要代理时返回代理地址，否则原样返回 */
export function proxyImageIfNeeded(url: string): string {
  return shouldUseImageProxy(url) ? toImageProxyUrl(url) : url;
}
