/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import Hls from 'hls.js';

export function cleanHtmlTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '\n') // 将 HTML 标签替换为换行
    .replace(/\n+/g, '\n') // 将多个连续换行合并为一个
    .replace(/[ \t]+/g, ' ') // 将多个连续空格和制表符合并为一个空格，但保留换行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾换行
    .replace(/&nbsp;/g, ' ') // 将 &nbsp; 替换为空格
    .trim(); // 去掉首尾空格
}

/**
 * 探测超时（毫秒）。
 *
 * 2026-10-17：原来只有 4 秒 —— 网络稍慢、源响应稍慢就会被判成「检测失败」，
 * 但用户点进去其实是能播的。放宽到 10 秒可以消掉大量误报。
 */
const PROBE_TIMEOUT_MS = 10000;

/**
 * 画质元数据已就绪、但分片速度还没算出来时，最多再等这么久。
 * 等不到就按「速度未知」正常返回，而不是一直挂到超时判失败。
 */
const SPEED_GRACE_MS = 2500;

/** 是不是 HLS 播放列表（只有它才需要用 hls.js 加载） */
function isM3u8Url(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url);
}

/** 根据视频宽度判断画质等级，使用经典分辨率的宽度作为分割点 */
function qualityFromWidth(width: number): string {
  if (width >= 3840) return '4K'; // 4K: 3840x2160
  if (width >= 2560) return '2K'; // 2K: 2560x1440
  if (width >= 1920) return '1080p'; // 1080p: 1920x1080
  if (width >= 1280) return '720p'; // 720p: 1280x720
  if (width >= 854) return '480p'; // 480p: 854x480
  return 'SD';
}

/**
 * 从播放地址获取视频质量等级和网络信息
 *
 * 2026-10-17 调整（目的是干掉「检测失败」的误报）：
 *  1. 超时 4s → 10s；
 *  2. **只有 m3u8 才用 hls.js**；mp4 等其它格式改用原生 video 探测画质，
 *     不再因为"不是 m3u8"就直接判失败；
 *  3. 画质一拿到就先返回（速度算不出来就显示"未知"），不再死等速度。
 *
 * @param videoUrl 播放地址（m3u8 / mp4 等）
 * @returns Promise<{quality: string, loadSpeed: string, pingTime: number}> 画质与网络信息
 */
export async function getVideoResolutionFromM3u8(videoUrl: string): Promise<{
  quality: string; // 如720p、1080p等
  loadSpeed: string; // 自动转换为KB/s或MB/s；测不出时为「未知」
  pingTime: number; // 网络延迟（毫秒）
}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';

    // 测网络延迟（HEAD 请求；no-cors 拿不到状态码，只用来量耗时）
    const pingStart = performance.now();
    let pingTime = 0;
    fetch(videoUrl, { method: 'HEAD', mode: 'no-cors' })
      .then(() => {
        pingTime = performance.now() - pingStart;
      })
      .catch(() => {
        pingTime = performance.now() - pingStart;
      });

    let settled = false;
    let loadSpeed = '未知';
    let hasSpeed = false;
    let fragmentStartTime = 0;
    let hls: Hls | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;

    /** 释放资源（无论成功失败都要走一遍，避免 hls 实例和 video 元素泄漏） */
    const cleanup = () => {
      if (graceTimer) clearTimeout(graceTimer);
      if (hardTimer) clearTimeout(hardTimer);
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* 忽略 */
        }
        hls = null;
      }
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* 忽略 */
      }
      video.remove();
    };

    /**
     * 收尾。ok=true 表示"探测成功"（画质可能未知，但那不是失败）；
     * 只有真的连元数据都拿不到才 ok=false。
     */
    const finish = (ok: boolean, err?: string) => {
      if (settled) return;
      settled = true;
      const width = video.videoWidth;
      const result = {
        quality: width > 0 ? qualityFromWidth(width) : '未知',
        loadSpeed,
        pingTime: Math.round(pingTime),
      };
      cleanup();
      if (ok) resolve(result);
      else reject(new Error(err || 'Failed to load video metadata'));
    };

    // 硬超时：已经拿到元数据就算成功（速度未知），否则才算失败
    hardTimer = setTimeout(() => {
      finish(video.readyState >= 1, 'Timeout loading video metadata');
    }, PROBE_TIMEOUT_MS);

    video.onerror = () => finish(false, 'Failed to load video metadata');

    video.onloadedmetadata = () => {
      if (settled) return;
      // 非 m3u8（如 mp4）：算不出分片速度，拿到画质就直接返回
      if (!isM3u8Url(videoUrl)) {
        finish(true);
        return;
      }
      // m3u8：再给速度一点时间，等不到就按「未知」返回
      if (!hasSpeed) {
        graceTimer = setTimeout(() => finish(true), SPEED_GRACE_MS);
      }
    };

    if (isM3u8Url(videoUrl)) {
      hls = new Hls();

      hls.on(Hls.Events.FRAG_LOADING, () => {
        fragmentStartTime = performance.now();
      });

      // 首个分片即可算出速度
      hls.on(Hls.Events.FRAG_LOADED, (_event: any, data: any) => {
        if (settled || hasSpeed || fragmentStartTime <= 0) return;
        if (!data || !data.payload) return;

        const loadTime = performance.now() - fragmentStartTime;
        const size = data.payload.byteLength || 0;
        if (loadTime > 0 && size > 0) {
          const speedKBps = size / 1024 / (loadTime / 1000);
          loadSpeed =
            speedKBps >= 1024
              ? `${(speedKBps / 1024).toFixed(1)} MB/s`
              : `${speedKBps.toFixed(1)} KB/s`;
          hasSpeed = true;
          // 画质 + 速度都有了 → 立刻返回
          if (video.readyState >= 1) finish(true);
        }
      });

      hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
        console.error('HLS错误:', data);
        // 致命错误：如果元数据已拿到就仍按成功返回，否则才算失败
        if (data && data.fatal) {
          finish(video.readyState >= 1, `HLS播放失败: ${data.type}`);
        }
      });

      hls.loadSource(videoUrl);
      hls.attachMedia(video);
    } else {
      // mp4 / 其它格式交给浏览器原生解码
      video.src = videoUrl;
    }
  });
}
