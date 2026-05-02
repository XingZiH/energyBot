/**
 * 9 种 ButtonAction 的 UI 元数据（图标 + 中文标题）。
 *
 * 提取到独立文件的理由：
 * - palette 面板（拖拽源）和 canvas 画布（按钮卡片）都要展示 action 的图标/标题，
 *   重复定义会导致后续增删 action 时漏改某一端，此处统一成单一事实来源。
 * - 用 `Record<ButtonAction, string>` 强制 TS 在新增 enum 值时编译报错，避免遗漏。
 */

import { ButtonAction } from '../types';

/** action → ng-zorro 图标名（outline 主题） */
export const ACTION_ICON_MAP: Record<ButtonAction, string> = {
  [ButtonAction.URL]: 'link',
  [ButtonAction.TEXT]: 'message',
  [ButtonAction.COMMAND]: 'code',
  [ButtonAction.START]: 'home',
  [ButtonAction.SUBMENU]: 'folder',
  [ButtonAction.ENERGY_PACKAGE_GROUP]: 'thunderbolt',
  [ButtonAction.ADDRESS_MANAGE]: 'environment',
  [ButtonAction.WALLET_QUERY]: 'wallet',
  [ButtonAction.ORDERS]: 'ordered-list',
};

/** action → 中文标题（palette 主标题 + canvas 空文本兜底） */
export const ACTION_TITLE_MAP: Record<ButtonAction, string> = {
  [ButtonAction.URL]: '网址链接',
  [ButtonAction.TEXT]: '文本消息',
  [ButtonAction.COMMAND]: '命令',
  [ButtonAction.START]: '开始',
  [ButtonAction.SUBMENU]: '子菜单',
  [ButtonAction.ENERGY_PACKAGE_GROUP]: '能量套餐组',
  [ButtonAction.ADDRESS_MANAGE]: '地址管理',
  [ButtonAction.WALLET_QUERY]: '钱包查询',
  [ButtonAction.ORDERS]: '我的订单',
};
