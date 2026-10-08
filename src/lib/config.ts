/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
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
  api_site: { [key: string]: ApiSite };
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

let fileConfig: ConfigFileStruct;
let cachedConfig: AdminConfig;
let initPromise: Promise<void> | null = null;

const ANNOUNCEMENT =
  process.env.ANNOUNCEMENT ||
  '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';

// 构建期（Cloudflare Pages）没有 D1 绑定，process.env.DB 为 undefined
function hasDatabaseBinding(): boolean {
  return !!(process.env as any).DB;
}

// 生成一份不依赖数据库的基础配置
function buildFallbackConfig(): AdminConfig {
  const entries = Object.entries(fileConfig?.api_site || {});
  const users: any[] = [];
  const owner = process.env.USERNAME;
  if (owner) {
    users.unshift({ username: owner, role: 'owner' });
  }
  return {
    SiteConfig: {
      SiteName: process.env.SITE_NAME || 'MoonTV',
      Announcement: ANNOUNCEMENT,
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: fileConfig?.cache_time || 7200,
      SearchResultDefaultAggregate:
        process.env.NEXT_PUBLIC_AGGREGATE_SEARCH_RESULT !== 'false',
    },
    UserConfig: {
      AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
      Users: users,
    },
    SourceConfig: entries.map(([key, site]) => ({
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
    const _require = eval('require') as NodeRequire;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');
    const p = path.join(process.cwd(), 'config.json');
    fileConfig = JSON.parse(fs.readFileSync(p, 'utf-8')) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }
}

async function initConfig() {
  if (cachedConfig) {
    return;
  }
  await ensureFileConfig();

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // 关键修复 1：构建期无 DB 绑定 / localstorage 模式，直接用文件配置
  if (storageType === 'localstorage' || !hasDatabaseBinding()) {
    cachedConfig = buildFallbackConfig();
    return;
  }

  // 关键修复 2：原代码是 (async () => {})() 没有 await，导致 cachedConfig
  // 来不及赋值，getConfig() 返回 undefined → "reading 'SiteConfig'" 崩溃。
  const fallback = buildFallbackConfig();

  try {
    const storage = getStorage();
    let adminConfig: AdminConfig | null = null;

    if (storage && typeof (storage as any).getAdminConfig === 'function') {
      adminConfig = await (storage as any).getAdminConfig();
    }

    let userNames: string[] = [];
    if (storage && typeof (storage as any).getAllUsers === 'function') {
      try {
        userNames = await (storage as any).getAllUsers();
      } catch (e) {
        console.error('获取用户列表失败:', e);
      }
    }

    const entries = Object.entries(fileConfig?.api_site || {});
    const owner = process.env.USERNAME;

    if (adminConfig) {
      if (!Array.isArray(adminConfig.SourceConfig)) {
        adminConfig.SourceConfig = [];
      }
      if (!adminConfig.UserConfig) {
        adminConfig.UserConfig = { AllowRegister: false, Users: [] } as any;
      }
      if (!Array.isArray(adminConfig.UserConfig.Users)) {
        adminConfig.UserConfig.Users = [];
      }

      const existed = new Set(adminConfig.SourceConfig.map((s) => s.key));
      entries.forEach(([key, site]) => {
        if (!existed.has(key)) {
          adminConfig!.SourceConfig.push({
            key,
            name: site.name,
            api: site.api,
            detail: site.detail,
            from: 'config',
            disabled: false,
          });
        }
      });

      const fileKeys = new Set(entries.map(([key]) => key));
      adminConfig.SourceConfig.forEach((s) => {
        if (!fileKeys.has(s.key)) {
          s.from = 'custom';
        }
      });

      const existedUsers = new Set(
        adminConfig.UserConfig.Users.map((u: any) => u.username)
              );
      userNames.forEach((uname) => {
        if (!existedUsers.has(uname)) {
          adminConfig!.UserConfig.Users.push({ username: uname, role: 'user' });
        }
      });

      if (owner) {
        adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter(
          (u: any) => u.username !== owner
        );
        adminConfig.UserConfig.Users.unshift({ username: owner, role: 'owner' });
      }
    } else {
      let users = userNames.map((uname) => ({ username: uname, role: 'user' }));
      if (owner) {
        users = users.filter((u) => u.username !== owner);
        users.unshift({ username: owner, role: 'owner' });
      }
      adminConfig = {
        ...fallback,
        UserConfig: {
          AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
          Users: users,
        },
      } as AdminConfig;
    }

    if (storage && typeof (storage as any).setAdminConfig === 'function') {
      await (storage as any).setAdminConfig(adminConfig);
    }

    cachedConfig = adminConfig;
  } catch (err) {
    console.error('加载管理员配置失败:', err);
    cachedConfig = fallback;
  }
}

export async function getConfig(): Promise<AdminConfig> {
  if (!cachedConfig) {
    if (!initPromise) {
      initPromise = initConfig().catch((err) => {
        console.error('初始化配置失败:', err);
        initPromise = null;
      });
    }
    await initPromise;
  }

  if (!cachedConfig) {
    try {
      await ensureFileConfig();
    } catch (e) {
      fileConfig = { api_site: {} };
    }
    cachedConfig = buildFallbackConfig();
  }

  return cachedConfig;
}

export async function resetConfig() {
  await ensureFileConfig();
  const fallback = buildFallbackConfig();
  let adminConfig = fallback;
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (storageType !== 'localstorage' && hasDatabaseBinding()) {
    try {
      const storage = getStorage();
      let userNames: string[] = [];
      if (storage && typeof (storage as any).getAllUsers === 'function') {
        try {
          userNames = await (storage as any).getAllUsers();
        } catch (e) {
          console.error('获取用户列表失败:', e);
        }
      }
      let users: any[] = userNames.map((u) => ({ username: u, role: 'user' }));
      const owner = process.env.USERNAME;
      if (owner) {
        users = users.filter((u) => u.username !== owner);
        users.unshift({ username: owner, role: 'owner' });
      }
      adminConfig = {
        ...fallback,
        UserConfig: {
          AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
          Users: users,
        },
      } as AdminConfig;
      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        await (storage as any).setAdminConfig(adminConfig);
      }
    } catch (err) {
      console.error('重置配置失败:', err);
      adminConfig = fallback;
    }
  }

  if (!cachedConfig) {
    cachedConfig = adminConfig;
  } else {
    cachedConfig.SiteConfig = adminConfig.SiteConfig;
    cachedConfig.UserConfig = adminConfig.UserConfig;
    cachedConfig.SourceConfig = adminConfig.SourceConfig;
  }
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function getAvailableApiSites(): Promise<ApiSite[]> {
  const config = await getConfig();
  return config.SourceConfig.filter((s) => !s.disabled).map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    detail: s.detail,
  }));
}
