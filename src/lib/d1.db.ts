/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { Favorite, IStorage, PlayRecord } from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// D1 数据库接口
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<D1ExecResult>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = any>(): Promise<D1Result<T>>;
}

interface D1Result<T = any> {
  results: T[];
  success: boolean;
  error?: string;
  meta: {
    changed_db: boolean;
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

// 数据库初始化 SQL
const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS play_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    source_name TEXT NOT NULL,
    cover TEXT NOT NULL,
    year TEXT NOT NULL,
    index_episode INTEGER NOT NULL,
    total_episodes INTEGER NOT NULL,
    play_time INTEGER NOT NULL,
    total_time INTEGER NOT NULL,
    save_time INTEGER NOT NULL,
    search_title TEXT,
    UNIQUE(username, key)
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    source_name TEXT NOT NULL,
    cover TEXT NOT NULL,
    year TEXT NOT NULL,
    total_episodes INTEGER NOT NULL,
    save_time INTEGER NOT NULL,
    UNIQUE(username, key)
  );

  CREATE TABLE IF NOT EXISTS search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    keyword TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(username, keyword)
  );

  CREATE TABLE IF NOT EXISTS admin_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    config TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  -- 用户在线状态（心跳）：供后台「谁在线」使用。每个用户只保留一行。
  CREATE TABLE IF NOT EXISTS user_activity (
    username TEXT PRIMARY KEY,
    last_seen INTEGER NOT NULL,
    ua TEXT,
    ip TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_activity_last_seen ON user_activity(last_seen DESC);

  -- 基本索引
  CREATE INDEX IF NOT EXISTS idx_play_records_username ON play_records(username);
  CREATE INDEX IF NOT EXISTS idx_favorites_username ON favorites(username);
  CREATE INDEX IF NOT EXISTS idx_search_history_username ON search_history(username);
  
  -- 复合索引优化查询性能
  -- 播放记录：用户名+键值的复合索引，用于快速查找特定记录
  CREATE INDEX IF NOT EXISTS idx_play_records_username_key ON play_records(username, key);
  -- 播放记录：用户名+保存时间的复合索引，用于按时间排序的查询
  CREATE INDEX IF NOT EXISTS idx_play_records_username_save_time ON play_records(username, save_time DESC);
  
  -- 收藏：用户名+键值的复合索引，用于快速查找特定收藏
  CREATE INDEX IF NOT EXISTS idx_favorites_username_key ON favorites(username, key);
  -- 收藏：用户名+保存时间的复合索引，用于按时间排序的查询
  CREATE INDEX IF NOT EXISTS idx_favorites_username_save_time ON favorites(username, save_time DESC);
  
  -- 搜索历史：用户名+关键词的复合索引，用于快速查找/删除特定搜索记录
  CREATE INDEX IF NOT EXISTS idx_search_history_username_keyword ON search_history(username, keyword);
  -- 搜索历史：用户名+创建时间的复合索引，用于按时间排序的查询
  CREATE INDEX IF NOT EXISTS idx_search_history_username_created_at ON search_history(username, created_at DESC);
  
  -- 搜索历史清理查询的优化索引
  CREATE INDEX IF NOT EXISTS idx_search_history_username_id_created_at ON search_history(username, id, created_at DESC);
`;

// 获取全局D1数据库实例
//
// 说明：Cloudflare Pages 运行时，process.env 是由本次请求 env 支撑的 Proxy，
// 所以 process.env.DB 拿到的就是绑定的 D1 实例。
// 绑定缺失时**必须显式报错**，否则会退化成
// 「Cannot read properties of undefined (reading 'prepare')」这种看不出原因的 500。
function getD1Database(): D1Database {
  let binding: unknown;
  try {
    binding = (process.env as any).DB;
  } catch (err) {
    throw new Error(
      `读取 D1 绑定失败（可能不在请求上下文中）: ${(err as Error).message}`
    );
  }

  if (!binding) {
    throw new Error(
      'D1 绑定 "DB" 不可用：请在 Cloudflare 项目 → 设置 → 绑定（生产环境）' +
        '确认已添加 D1 数据库且变量名正好是 DB，然后重新部署一次。'
    );
  }

  return binding as D1Database;
}

export class D1Storage implements IStorage {
  private db: D1Database | null = null;
  private initialized = false;

  private async getDatabase(): Promise<D1Database> {
    if (!this.db) {
      this.db = getD1Database();
    }

    if (!this.initialized) {
      // 先置位：保证初始化失败也不会让后续请求反复重试
      this.initialized = true;
      try {
        await this.initDatabase();
      } catch (err) {
        // ⚠️ 建表失败**绝不能**让请求失败：
        // 表可能已经存在（例如已在 D1 控制台手动执行过建表 SQL），
        // 真正的查询问题会在后面的查询里自然暴露，并带上明确的错误信息。
        console.error('D1 初始化失败（继续尝试查询）:', err);
      }
    }

    return this.db;
  }

  private async initDatabase() {
    const db = this.db;
    if (!db) {
      return;
    }

    try {
      await db.exec(INIT_SQL);
      return;
    } catch (err) {
      // D1 的 exec() 对多语句批处理比较挑剔；失败时逐条执行兜底，
      // 同时把出错的具体语句打进日志，便于定位。
      console.error('D1 exec(INIT_SQL) 失败，改为逐条执行:', err);
    }

    const statements = INIT_SQL.split(';')
      .map((sql) =>
        sql
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim()
      )
      .filter(Boolean);

    for (const statement of statements) {
      try {
        await db.prepare(statement).run();
      } catch (err) {
        console.error(`D1 建表语句执行失败: ${statement}`, err);
      }
    }
  }

  // ===== 用户在线状态（心跳）=====

  /**
   * 记录一次用户活动（心跳）。
   * 同一用户反复调用只更新同一行；`last_seen` 为毫秒时间戳。
   */
  async touchUserActivity(
    userName: string,
    ua?: string,
    ip?: string
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `INSERT INTO user_activity (username, last_seen, ua, ip)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET
             last_seen = excluded.last_seen,
             ua = excluded.ua,
             ip = excluded.ip`
        )
        .bind(userName, Date.now(), ua || null, ip || null)
        .run();
    } catch (err) {
      // 心跳失败不应影响任何主流程
      console.error('Failed to touch user activity:', err);
    }
  }

  /** 读取所有用户的最后活动时间（username -> 毫秒时间戳）。 */
  async getAllUserActivity(): Promise<Record<string, number>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT username, last_seen FROM user_activity')
        .all<any>();

      const map: Record<string, number> = {};
      (result.results || []).forEach((row: any) => {
        map[row.username] = row.last_seen;
      });
      return map;
    } catch (err) {
      console.error('Failed to get user activity:', err);
      return {};
    }
  }

  // 播放记录相关
  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        index: result.index_episode,
        total_episodes: result.total_episodes,
        play_time: result.play_time,
        total_time: result.total_time,
        save_time: result.save_time,
        search_title: result.search_title || undefined,
      };
    } catch (err) {
      console.error('Failed to get play record:', err);
      throw err;
    }
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO play_records 
          (username, key, title, source_name, cover, year, index_episode, total_episodes, play_time, total_time, save_time, search_title)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          record.title,
          record.source_name,
          record.cover,
          record.year,
          record.index,
          record.total_episodes,
          record.play_time,
          record.total_time,
          record.save_time,
          record.search_title || null
        )
        .run();
    } catch (err) {
      console.error('Failed to set play record:', err);
      throw err;
    }
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM play_records WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const records: Record<string, PlayRecord> = {};

      result.results.forEach((row: any) => {
        records[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          index: row.index_episode,
          total_episodes: row.total_episodes,
          play_time: row.play_time,
          total_time: row.total_time,
          save_time: row.save_time,
          search_title: row.search_title || undefined,
        };
      });

      return records;
    } catch (err) {
      console.error('Failed to get all play records:', err);
      throw err;
    }
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete play record:', err);
      throw err;
    }
  }

  // 收藏相关
  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        total_episodes: result.total_episodes,
        save_time: result.save_time,
      };
    } catch (err) {
      console.error('Failed to get favorite:', err);
      throw err;
    }
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO favorites 
          (username, key, title, source_name, cover, year, total_episodes, save_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          favorite.title,
          favorite.source_name,
          favorite.cover,
          favorite.year,
          favorite.total_episodes,
          favorite.save_time
        )
        .run();
    } catch (err) {
      console.error('Failed to set favorite:', err);
      throw err;
    }
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM favorites WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const favorites: Record<string, Favorite> = {};

      result.results.forEach((row: any) => {
        favorites[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          total_episodes: row.total_episodes,
          save_time: row.save_time,
        };
      });

      return favorites;
    } catch (err) {
      console.error('Failed to get all favorites:', err);
      throw err;
    }
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete favorite:', err);
      throw err;
    }
  }

  // 用户相关
  async registerUser(userName: string, password: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
        .bind(userName, password)
        .run();
    } catch (err) {
      console.error('Failed to register user:', err);
      throw err;
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT password FROM users WHERE username = ?')
        .bind(userName)
        .first<{ password: string }>();

      return result?.password === password;
    } catch (err) {
      console.error('Failed to verify user:', err);
      throw err;
    }
  }

  async checkUserExist(userName: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT 1 FROM users WHERE username = ?')
        .bind(userName)
        .first();

      return result !== null;
    } catch (err) {
      console.error('Failed to check user existence:', err);
      throw err;
    }
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('UPDATE users SET password = ? WHERE username = ?')
        .bind(newPassword, userName)
        .run();
    } catch (err) {
      console.error('Failed to change password:', err);
      throw err;
    }
  }

  async deleteUser(userName: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const statements = [
        db.prepare('DELETE FROM users WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM play_records WHERE username = ?')
          .bind(userName),
        db.prepare('DELETE FROM favorites WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName),
      ];

      await db.batch(statements);
    } catch (err) {
      console.error('Failed to delete user:', err);
      throw err;
    }
  }

  /**
   * 清空某个用户的「历史数据」，但**保留账号本身**。
   *
   * 与 deleteUser 的区别：deleteUser 连账号（users 表那一行）一起删，
   * 这里只清播放记录 / 收藏 / 搜索历史 / 在线状态，用户还能照常登录。
   * 用途：人还留着，但想把他看过的痕迹抹掉。
   */
  async clearUserData(userName: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const statements = [
        db
          .prepare('DELETE FROM play_records WHERE username = ?')
          .bind(userName),
        db.prepare('DELETE FROM favorites WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName),
        db
          .prepare('DELETE FROM user_activity WHERE username = ?')
          .bind(userName),
      ];

      await db.batch(statements);
    } catch (err) {
      console.error('Failed to clear user data:', err);
      throw err;
    }
  }

  // 搜索历史相关
  async getSearchHistory(userName: string): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT keyword FROM search_history WHERE username = ? ORDER BY created_at DESC LIMIT ?'
        )
        .bind(userName, SEARCH_HISTORY_LIMIT)
        .all<{ keyword: string }>();

      return result.results.map((row) => row.keyword);
    } catch (err) {
      console.error('Failed to get search history:', err);
      throw err;
    }
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      // 先删除可能存在的重复记录
      await db
        .prepare(
          'DELETE FROM search_history WHERE username = ? AND keyword = ?'
        )
        .bind(userName, keyword)
        .run();

      // 添加新记录
      await db
        .prepare('INSERT INTO search_history (username, keyword) VALUES (?, ?)')
        .bind(userName, keyword)
        .run();

      // 保持历史记录条数限制
      await db
        .prepare(
          `
          DELETE FROM search_history 
          WHERE username = ? AND id NOT IN (
            SELECT id FROM search_history 
            WHERE username = ? 
            ORDER BY created_at DESC 
            LIMIT ?
          )
        `
        )
        .bind(userName, userName, SEARCH_HISTORY_LIMIT)
        .run();
    } catch (err) {
      console.error('Failed to add search history:', err);
      throw err;
    }
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      if (keyword) {
        await db
          .prepare(
            'DELETE FROM search_history WHERE username = ? AND keyword = ?'
          )
          .bind(userName, keyword)
          .run();
      } else {
        await db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName)
          .run();
      }
    } catch (err) {
      console.error('Failed to delete search history:', err);
      throw err;
    }
  }

  // 用户列表
  async getAllUsers(): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT username FROM users ORDER BY created_at ASC')
        .all<{ username: string }>();

      return result.results.map((row) => row.username);
    } catch (err) {
      console.error('Failed to get all users:', err);
      throw err;
    }
  }

  // 管理员配置相关
  async getAdminConfig(): Promise<AdminConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT config FROM admin_config WHERE id = 1')
        .first<{ config: string }>();

      if (!result) return null;

      return JSON.parse(result.config) as AdminConfig;
    } catch (err) {
      console.error('Failed to get admin config:', err);
      throw err;
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          'INSERT OR REPLACE INTO admin_config (id, config) VALUES (1, ?)'
        )
        .bind(JSON.stringify(config))
        .run();
    } catch (err) {
      console.error('Failed to set admin config:', err);
      throw err;
    }
  }
}
