// ui/src/app/pages/energy-rental/agent-bot-config/designer/types.ts

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
  url?: string;
  message?: string;
  command?: string;
  submenu?: MenuRow[];
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
  menuConfig: MenuRow[];
  messageConfig: MessageTemplates;
  updatedAt?: string;
}

export const MAX_MENU_DEPTH = 3;
export const MAX_BUTTONS_PER_ROW = 4;
export const MAX_ROWS_PER_MENU = 8;
export const MAX_BUTTON_TEXT_LEN = 64;

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
