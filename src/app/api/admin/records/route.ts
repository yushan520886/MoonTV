/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';

export const runtime = 'edge';

/** 多久内有心跳算「在线」（毫秒） */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
/** 「近期活跃」窗口：7 天 */
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function noStore(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * 后台「用户活动」查询接口
 *
 * - `?type=overview`            → 所有用户的统计 + 在线状态（后台首页卡片 & 明细表）
 * - `?type=detail&username=xxx` → 某个用户的观看记录 / 收藏 / 搜索历史
 *
 * 权限沿用现有规则：站长看全部；管理员只能看普通用户，不能看站长。
 */
export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return noStore({ error: '不支持本地存储进行管理员配置' }, 400);
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return noStore({ error: 'Unauthorized' }, 401);
  }
  const operator = authInfo.username;

  const config = await getConfig();

  // 判定操作者角色
  let operatorRole: 'owner' | 'admin';
  if (operator === process.env.USERNAME) {
    operatorRole = 'owner';
  } else {
    const me = config.UserConfig.Users.find((u) => u.username === operator);
    if (!me || me.role !== 'admin') {
      return noStore({ error: '权限不足' }, 401);
    }
    operatorRole = 'admin';
  }

  const storage: IStorage | null = getStorage();
  if (!storage) {
    return noStore({ error: '存储未就绪' }, 500);
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'overview';
  const target = searchParams.get('username');

  // 管理员不能查看站长
  if (target && operatorRole !== 'owner') {
    const t = config.UserConfig.Users.find((u) => u.username === target);
    if (t && t.role === 'owner') {
      return noStore({ error: '权限不足' }, 401);
    }
  }

  /** 读取「用户名 -> 最后心跳时间」映射（存储不支持时返回空表） */
  const readActivity = async (): Promise<Record<string, number>> => {
    const fn = (storage as any).getAllUserActivity;
    if (typeof fn !== 'function') return {};
    try {
      return (await fn.call(storage)) || {};
    } catch {
      return {};
    }
  };

  try {
    // ========== 总览 ==========
    if (type === 'overview') {
      let usernames: string[] = [];
      try {
        const fn = (storage as any).getAllUsers;
        if (typeof fn === 'function') usernames = (await fn.call(storage)) || [];
      } catch (e) {
        console.error('getAllUsers 失败:', e);
      }

      // 站长可能不在用户表里，补齐
      const ownerName = process.env.USERNAME;
      if (ownerName && !usernames.includes(ownerName)) usernames.unshift(ownerName);

      const activityMap = await readActivity();
      const now = Date.now();

      const rows: any[] = [];
      let totalRecords = 0;
      let totalFavorites = 0;
      let onlineUsers = 0;
      let activeLast7Days = 0;

      for (const uname of usernames) {
        let records: Record<string, any> = {};
        let favorites: Record<string, any> = {};
        let searches: string[] = [];
        try {
          records = (await storage.getAllPlayRecords(uname)) || {};
        } catch {
          /* 忽略：单个用户某项数据读取失败不影响整体 */
        }
        try {
          favorites = (await storage.getAllFavorites(uname)) || {};
        } catch {
          /* 忽略 */
        }
        try {
          searches = (await storage.getSearchHistory(uname)) || [];
        } catch {
          /* 忽略 */
        }

        const rc = Object.keys(records).length;
        const fc = Object.keys(favorites).length;
        totalRecords += rc;
        totalFavorites += fc;

        const lastPlay = Object.values(records).reduce(
          (m: number, r: any) => Math.max(m, Number(r?.save_time) || 0),
          0
        );
        const lastSeen = Number(activityMap[uname]) || 0;
        const online = lastSeen > 0 && now - lastSeen < ONLINE_WINDOW_MS;
        const lastActive = Math.max(lastPlay, lastSeen);

        if (online) onlineUsers += 1;
        if (lastActive > 0 && now - lastActive < ACTIVE_WINDOW_MS) activeLast7Days += 1;

        const cfgUser = config.UserConfig.Users.find((u) => u.username === uname);
        rows.push({
          username: uname,
          role: uname === ownerName ? 'owner' : cfgUser?.role || 'user',
          banned: !!cfgUser?.banned,
          records: rc,
          favorites: fc,
          searches: searches.length,
          lastPlay,
          lastSeen,
          online,
        });
      }

      // 在线优先，其次按最后活跃时间倒序
      rows.sort(
        (a, b) =>
          Number(b.online) - Number(a.online) ||
          Math.max(b.lastSeen, b.lastPlay) - Math.max(a.lastSeen, a.lastPlay)
      );

      return noStore({
        stats: {
          totalUsers: usernames.length,
          onlineUsers,
          activeLast7Days,
          totalRecords,
          totalFavorites,
        },
        users: rows,
        serverTime: now,
        onlineWindowMs: ONLINE_WINDOW_MS,
      });
    }

    // ========== 单个用户详情 ==========
    if (type === 'detail') {
      if (!target) return noStore({ error: '缺少 username 参数' }, 400);

      let records: Record<string, any> = {};
      let favorites: Record<string, any> = {};
      let searches: string[] = [];
      try {
        records = (await storage.getAllPlayRecords(target)) || {};
      } catch {
        /* 忽略 */
      }
      try {
        favorites = (await storage.getAllFavorites(target)) || {};
      } catch {
        /* 忽略 */
      }
      try {
        searches = (await storage.getSearchHistory(target)) || [];
      } catch {
        /* 忽略 */
      }

      const toList = (obj: Record<string, any>) =>
        Object.entries(obj)
          .map(([key, v]) => ({ key, ...(v as any) }))
          .sort((a, b) => (Number(b.save_time) || 0) - (Number(a.save_time) || 0));

      const activityMap = await readActivity();
      const lastSeen = Number(activityMap[target]) || 0;

      return noStore({
        username: target,
        online: lastSeen > 0 && Date.now() - lastSeen < ONLINE_WINDOW_MS,
        lastSeen,
        records: toList(records),
        favorites: toList(favorites),
        searchHistory: searches,
      });
    }

    return noStore({ error: '未知的 type 参数' }, 400);
  } catch (error) {
    console.error('查询用户活动失败:', error);
    return noStore({ error: '查询失败', details: (error as Error).message }, 500);
  }
}
