/**
 * 豆瓣分类筛选的共享常量与工具。
 *
 * 设计要点：
 * 1. 筛选项的 `value` 直接就是豆瓣认识的标签原文（中文），
 *    因此「地区 + 类型 + 年代」可以逗号拼接后一次性交给豆瓣，
 *    天然实现多条件联动。
 * 2. 本文件是**唯一取值来源**：分类筛选栏、站点导航都从这里取，
 *    避免两边各写一份导致取值不一致。
 */

/** 「不限」的统一取值 */
export const FILTER_ALL = 'all';

export interface FilterOption {
  /** 界面展示文案 */
  label: string;
  /** 传给豆瓣的取值；等于 FILTER_ALL 时表示该维度不限 */
  value: string;
}

/** 内容类型（对应页面的 type 参数）→ 豆瓣 tags 的首个标签 */
export const KIND_LABEL: Record<string, string> = {
  movie: '电影',
  tv: '电视剧',
  variety: '综艺',
  anime: '动漫',
};

/** 支持筛选的内容类型（顺序即界面顺序） */
export const KIND_OPTIONS: FilterOption[] = [
  { label: '电影', value: 'movie' },
  { label: '剧集', value: 'tv' },
  { label: '综艺', value: 'variety' },
  { label: '动漫', value: 'anime' },
];

/**
 * 地区。
 *
 * 值用的是豆瓣的地区标签原文，所以这里**只能增删、不能随意改写**，
 * 改错一个字豆瓣就查不到结果。
 */
export const REGION_OPTIONS: FilterOption[] = [
  { label: '不限', value: FILTER_ALL },
  { label: '华语', value: '华语' },
  { label: '欧美', value: '欧美' },
  { label: '韩国', value: '韩国' },
  { label: '日本', value: '日本' },
  { label: '泰国', value: '泰国' },
  { label: '印度', value: '印度' },
  { label: '中国大陆', value: '中国大陆' },
  { label: '中国香港', value: '香港' },
  { label: '中国台湾', value: '台湾' },
  { label: '美国', value: '美国' },
  { label: '英国', value: '英国' },
  { label: '法国', value: '法国' },
  { label: '德国', value: '德国' },
  { label: '意大利', value: '意大利' },
  { label: '西班牙', value: '西班牙' },
  { label: '俄罗斯', value: '俄罗斯' },
  { label: '加拿大', value: '加拿大' },
  { label: '澳大利亚', value: '澳大利亚' },
  { label: '爱尔兰', value: '爱尔兰' },
  { label: '瑞典', value: '瑞典' },
  { label: '巴西', value: '巴西' },
  { label: '丹麦', value: '丹麦' },
];

/** 类型（标签），值同样是豆瓣标签原文 */
export const GENRE_OPTIONS: FilterOption[] = [
  { label: '不限', value: FILTER_ALL },
  { label: '剧情', value: '剧情' },
  { label: '喜剧', value: '喜剧' },
  { label: '爱情', value: '爱情' },
  { label: '动作', value: '动作' },
  { label: '科幻', value: '科幻' },
  { label: '动画', value: '动画' },
  { label: '悬疑', value: '悬疑' },
  { label: '惊悚', value: '惊悚' },
  { label: '恐怖', value: '恐怖' },
  { label: '犯罪', value: '犯罪' },
  { label: '战争', value: '战争' },
  { label: '奇幻', value: '奇幻' },
  { label: '冒险', value: '冒险' },
  { label: '家庭', value: '家庭' },
  { label: '儿童', value: '儿童' },
  { label: '传记', value: '传记' },
  { label: '历史', value: '历史' },
  { label: '音乐', value: '音乐' },
  { label: '歌舞', value: '歌舞' },
  { label: '武侠', value: '武侠' },
  { label: '古装', value: '古装' },
  { label: '运动', value: '运动' },
  { label: '灾难', value: '灾难' },
  { label: '西部', value: '西部' },
  { label: '黑色电影', value: '黑色电影' },
  { label: '短片', value: '短片' },
  { label: '纪录片', value: '纪录片' },
];

/** 年代 */
export const YEAR_OPTIONS: FilterOption[] = [
  { label: '不限', value: FILTER_ALL },
  { label: '2026', value: '2026' },
  { label: '2025', value: '2025' },
  { label: '2024', value: '2024' },
  { label: '2023', value: '2023' },
  { label: '2022', value: '2022' },
  { label: '2021', value: '2021' },
  { label: '2020', value: '2020' },
  { label: '2019', value: '2019' },
  { label: '2018', value: '2018' },
  { label: '2017', value: '2017' },
  { label: '2016', value: '2016' },
  { label: '2015', value: '2015' },
  { label: '2010年代', value: '2010年代' },
  { label: '2000年代', value: '2000年代' },
  { label: '90年代', value: '90年代' },
  { label: '80年代', value: '80年代' },
  { label: '更早', value: '更早' },
];

/**
 * 排序。
 *
 * ⚠️ 取值是照着实测结果定的，不要凭记忆改：
 *  - S = 评分排序（实测返回 9.8 / 9.8 / 9.7 / 9.7 / 9.6，严格降序）
 *  - T = 热度排序（实测返回 我不是药神 / 肖申克的救赎 / 千与千寻）
 *  - U = 最新排序（实测返回当期新片）
 */
export const SORT_OPTIONS: FilterOption[] = [
  { label: '热度', value: 'T' },
  { label: '评分', value: 'S' },
  { label: '最新', value: 'U' },
];

export const DEFAULT_SORT = 'T';

/**
 * 走「分类筛选」接口时，豆瓣每页固定返回 20 条。
 * ⚠️ 不要试图用 `range` 控制条数 —— `range` 是**评分区间**，
 * 传 `0,5` 这类值豆瓣会直接返回空列表（实测）。
 */
export const FILTER_PAGE_SIZE = 20;

/** 所有可被 URL 传递的筛选项，按白名单校验，避免任意值透传给豆瓣 */
const OPTION_MAP = {
  region: REGION_OPTIONS,
  genre: GENRE_OPTIONS,
  year: YEAR_OPTIONS,
  sort: SORT_OPTIONS,
};

function isAllowed(key: keyof typeof OPTION_MAP, value: string | null): boolean {
  if (!value) return false;
  return OPTION_MAP[key].some((item) => item.value === value);
}

/**
 * 把筛选条件拼成豆瓣的 `tags`。
 *
 * 实测结论（2026-10-10）：
 *  - `tags` 支持逗号分隔的多标签，如 `电影,泰国,喜剧`，返回 20 条正常结果；
 *  - 豆瓣虽然另有 `countries` / `genres` 独立参数，但**同时传两个会返回 0 条**，
 *    所以这里统一塞进 `tags`，只在 `tags` 里做组合。
 */
export function buildDoubanTags(params: {
  kind?: string | null;
  region?: string | null;
  genre?: string | null;
  year?: string | null;
}): string {
  const parts: string[] = [];

  const kindLabel = params.kind ? KIND_LABEL[params.kind] : undefined;
  if (kindLabel) parts.push(kindLabel);

  if (isAllowed('region', params.region ?? null)) parts.push(params.region as string);
  if (isAllowed('genre', params.genre ?? null)) parts.push(params.genre as string);
  if (isAllowed('year', params.year ?? null)) parts.push(params.year as string);

  return parts.join(',');
}

/** 规整排序值：非法值一律回落到默认热度排序 */
export function normalizeSort(sort?: string | null): string {
  return isAllowed('sort', sort ?? null) ? (sort as string) : DEFAULT_SORT;
}

/** 取出某个维度下合法的筛选项，非法/缺失时回落到「不限」 */
export function resolveOption(
  key: 'region' | 'genre' | 'year',
  value?: string | null
): FilterOption {
  const options = OPTION_MAP[key];
  const fallback = options[0];
  if (!value) return fallback;
  return options.find((item) => item.value === value) ?? fallback;
}

/** 是否设置了「不限」以外的条件 */
export function hasActiveFilter(params: {
  region?: string | null;
  genre?: string | null;
  year?: string | null;
}): boolean {
  return (['region', 'genre', 'year'] as const).some((key) => {
    const value = params[key];
    return isAllowed(key, value ?? null);
  });
}
