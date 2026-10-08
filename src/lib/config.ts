/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import { getStorage } from '@/lib/db';

import { AdminConfig } from './admin.types';
import runtimeConfig from './runtime';

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site: {
    [key: string]: ApiSite;
  };
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 在模块加载时根据环境决定配置来源
let fileConfig: ConfigFileStruct;
let cachedConfig: AdminConfig;
let initPromise: Promise<void> | null = null;

// 安全地读取数据库绑定：构建期（Cloudflare Pages build）没有 D1 绑定，
// 此时 process.env.DB 为 undefined，需要优雅降级而不是抛错。
function hasDatabaseBinding(): boolean {
  return !!(process.env as any).DB;
}

// 从 fileConfig 构建一份不含数据库信息的基础配置（纯函数，任何时候都能算出来）
function buildFallbackConfig(): AdminConfig {
  const apiSiteEntries = Object.entries(fileConfig?.api_site || {});
  const allUsers: { username: string; role: string }[] = [];
  const ownerUser = process.env.USERNAME;
  if (ownerUser) {
    allUsers.unshift({
      username: ownerUser,
      role: 'owner',
    });
  }

  return {
    SiteConfig: {
      SiteName: process.env.SITE_NAME || 'MoonTV',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: fileConfig?.cache_time || 7200,
      SearchResultDefaultAggregate:
        process.env.NEXT_PUBLIC_AGGREGATE_SEARCH_RESULT !== 'false',
    },
    UserConfig: {
      AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
      Users: allUsers as any,
    },
    SourceConfig: apiSiteEntries.map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    })),
  } as AdminConfig;
}

async function ensureFileConfig() {
  if (fileConfig) {
    return;
  }

  if (process.env.DOCKER_ENV === 'true') {
    // 这里用 eval("require") 避开静态分析，防止 Edge Runtime 打包时报 "Can't resolve 'fs'"
    // 在实际 Node.js 运行时才会执行到，因此不会影响 Edge 环境。
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeRequire;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    // 默认使用编译时生成的配置
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }
}

async function initConfig() {
  if (cachedConfig) {
    return;
  }

  await ensureFileConfig();

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // 关键修复 1：构建期（Cloudflare Pages / next build 预渲染）没有 D1 绑定，
  // 也不能访问数据库。此时直接用文件配置作为配置源，避免 prerender 崩溃。
  if (storageType === 'localstorage' || !hasDatabaseBinding()) {
    cachedConfig = buildFallbackConfig();
    return;
  }

  // 数据库存储：读取并补全管理员配置
  // 关键修复 2：原来是 (async () => {})() 没有 await，导致 cachedConfig 来不及赋值，
  // getConfig() 返回 undefined，进而抛出 "Cannot read properties of undefined (reading 'SiteConfig')"。
  // 这里改为真正的 await，并保证失败时也有兜底配置。
  const fallback = buildFallbackConfig();

  try {
    const storage = getStorage();

    // 尝试从数据库获取管理员配置
    let adminConfig: AdminConfig | null = null;
    if (storage && typeof (storage as any).getAdminConfig === 'function') {
      adminConfig = await (storage as any).getAdminConfig();
    }

    // 获取所有用户名，用于补全 Users
    let userNames: string[] = [];
    if (storage && typeof (storage as any).getAllUsers === 'function') {
      try {
        userNames = await (storage as any).getAllUsers();
      } catch (e) {
        console.error('获取用户列表失败:', e);
      }
    }

    // 从文件中获取源信息，用于补全源
    const apiSiteEntries = Object.entries(fileConfig?.api_site || {});

    if (adminConfig) {
      // 兜底：历史数据可能缺少某些字段，避免后续 setAdminConfig 序列化时出错
      if (!Array.isArray(adminConfig.SourceConfig)) {
        adminConfig.SourceConfig = [];
      }
      if (!adminConfig.UserConfig) {
        adminConfig.UserConfig = { AllowRegister: false, Users: [] } as any;
      }
      if (!Array.isArray(adminConfig.UserConfig.Users)) {
        adminConfig.UserConfig.Users = [] as 
