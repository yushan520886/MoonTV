/* eslint-disable no-console */

'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';

/**
 * 退出登录按钮
 *
 * 退出流程（后台登录/退出流程优化）：
 * 1. 先把结果收好，再清理状态 —— 即使注销请求失败也要继续走完流程，
 *    否则用户会「点了退出却没反应」，停在已登录界面。
 * 2. 用 window.location.replace 而不是 reload：
 *    - reload 会留在原页面（后台/首页），退出后仍可能看到已登录界面；
 *    - replace 不写入历史记录 → 之后按「后退」也回不到已登录的页面。
 * 3. 统一跳到 /login（与前台登录页同一个页面，风格一致）。
 */
export const LogoutButton: React.FC = () => {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    if (loading) return;

    setLoading(true);

    try {
      // 清除站点会话 + 后台门禁 Cookie
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
    } catch (error) {
      console.error('注销请求失败:', error);
      // 不中断：本地仍然要把用户带离当前页面
    }

    // replace 而非 reload：离开当前页面，且不留历史记录
    window.location.replace('/login');
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors disabled:opacity-50'
      aria-label='退出登录'
      title='退出登录'
    >
      <LogOut className='w-full h-full' />
    </button>
  );
};
