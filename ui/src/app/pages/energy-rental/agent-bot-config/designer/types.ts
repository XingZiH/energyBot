/**
 * Bot 设计器前端类型契约
 *
 * 此文件是三端共享数据契约的前端定义，对应：
 * - Go 端：go-bot/internal/telegram/designer.go
 * - NestJS 端：nest-api/src/modules/energy-rental/dto/ui-config.dto.ts
 *
 * 修改此文件时务必同步修改以上两处。
 * 枚举字符串字面量和可选字段 JSON key 必须与 Go struct tag 完全一致。
 */

export enum ButtonAction {
  URL = 'url',
  TEXT = 'text',
  COMMAND = 'command',
  START = 'start',
  SUBMENU = 'submenu',
  ENERGY_PACKAGE_GROUP = 'energy_package_group',
  ADDRESS_MANAGE = 'address_manage',
  WALLET_QUERY = 'wallet_query',
  ORDERS = 'orders',
}

export interface ButtonStyle {
  bgColor?: string;
  textColor?: string;
}

export interface PackageGroup {
  packageIds: number[];
  sortBy: 'price_asc' | 'price_desc' | 'manual';
  textTemplate: string;
}

export interface MenuButton {
  id: string;
  text: string;
  action: ButtonAction;
  style?: ButtonStyle;
  /** action === 'url' 时必填 */
  url?: string;
  /** action === 'text' 时必填 */
  message?: string;
  /** action === 'command' 时必填 */
  command?: string;
  /** action === 'submenu' 时必填 */
  submenu?: MenuRow[];
  /** action === 'energy_package_group' 时必填 */
  packageGroup?: PackageGroup;
}

export interface MenuRow {
  id: string;
  buttons: MenuButton[];
}

export interface MessageTemplates {
  welcome: string;
  orderCreated: string;
  payPending: string;
  paySuccess: string;
  payFailed: string;
  addressInvalid: string;
  unknownCommand: string;
  packageUnavailable: string;
  walletQueryResult: string;
}

export interface BotDesignerConfig {
  welcomeText: string;
  packageGroupText: string;
  menuConfig: MenuRow[];
  messageConfig: MessageTemplates;
  /** 由后端 GET 返回的最后修改时间戳（ISO8601），前端写入时不需要传 */
  updatedAt?: string;
}

export const MAX_MENU_DEPTH = 3;
export const MAX_BUTTONS_PER_ROW = 4;
export const MAX_ROWS_PER_MENU = 8;
export const MAX_BUTTON_TEXT_LEN = 64;

/**
 * 初始化消息模板表单的工厂函数。
 *
 * MessageTemplates 的 9 个字段均为必填，集中初始化便于新增字段时统一维护。
 */
export function createEmptyMessageTemplates(): MessageTemplates {
  return {
    welcome: '',
    orderCreated: '',
    payPending: '',
    paySuccess: '',
    payFailed: '',
    addressInvalid: '',
    unknownCommand: '',
    packageUnavailable: '',
    walletQueryResult: '',
  };
}
