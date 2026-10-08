import { NextResponse } from 'next/server';

export const runtime = 'edge';

// 允许代理的图片域名白名单（防止被当作开放代理滥用）
const ALLOWED_HOSTS = [
  'doubanio.com',
  'douban.com',
  'dbimg.com',
  'qpic.cn',
  'alicdn.com',
  'tmdb.org',
  'themoviedb.org',
  'b1imgs.com',
  'mgtv.com',
  'hdslb.com',
  'iqiyipic.com',
  'pplive.com',
];

function isAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  const decoded = decodeURIComponent(imageUrl);

  if (!/^https?:\/\//i.test(decoded)) {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }

  if (!isAllowed(decoded)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
  }

  // 超时保护：避免上游图床卡住拖垮边缘函数
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const imageResponse = await fetch(decoded, {
      signal: controller.signal,
      headers: {
        // 豆瓣图床对 Referer 有校验，带上正确来源可避免 403
        Referer: 'https://movie.douban.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    clearTimeout(timeoutId);

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: `Upstream ${imageResponse.status}` },
        { status: imageResponse.status }
      );
    }

    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 502 }
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    // 缓存 24 小时，显著降低图床压力与加载耗时
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    // 允许跨域使用，兼容 Selene 等 WebView 客户端
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(imageResponse.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 504 }
    );
  }
}
