export interface PersonalQuickAction {
  label: string;
  route: string;
  icon: string;
  description: string;
  userOnly?: boolean;
}

export interface PersonalSettingSection {
  key: 'profile' | 'security' | 'preferences';
  title: string;
  icon: string;
}

export interface PersonalPreference {
  rechargeHint: boolean;
  orderStatus: boolean;
  compactOverview: boolean;
}

export const PERSONAL_PREFERENCE_STORAGE_KEY = 'maer-energy-personal-preferences';

export const DEFAULT_PERSONAL_PREFERENCES: PersonalPreference = {
  rechargeHint: true,
  orderStatus: true,
  compactOverview: false
};

export const PERSONAL_CENTER_QUICK_ACTIONS: PersonalQuickAction[] = [
  {
    label: '用户充值',
    route: '/default/energy-rental/agent-recharge',
    icon: 'wallet',
    description: '创建充值订单并查看入账记录',
    userOnly: true
  },
  {
    label: '机器人配置',
    route: '/default/energy-rental/bot-config',
    icon: 'robot',
    description: '维护自己的 Telegram 机器人'
  },
  {
    label: '套餐配置',
    route: '/default/energy-rental/packages',
    icon: 'profile',
    description: '基于平台价格创建销售套餐'
  },
  {
    label: '地址管理',
    route: '/default/energy-rental/address-management',
    icon: 'environment',
    description: '查看用户收能地址和订单统计'
  },
  {
    label: '订单管理',
    route: '/default/energy-rental/orders',
    icon: 'ordered-list',
    description: '跟踪支付、下发和完成状态'
  },
  {
    label: '钱包流水',
    route: '/default/energy-rental/wallet-transactions',
    icon: 'transaction',
    description: '核对充值、扣款与链上流水'
  }
];

export function getPersonalCenterQuickActions(authCodes: string[]): PersonalQuickAction[] {
  const isAdmin = authCodes.includes('default:energy-rental:platform-config');
  return PERSONAL_CENTER_QUICK_ACTIONS.filter(item => !(isAdmin && item.userOnly));
}

export const PERSONAL_SETTING_SECTIONS: PersonalSettingSection[] = [
  { key: 'profile', title: '账户资料', icon: 'idcard' },
  { key: 'security', title: '安全设置', icon: 'safety-certificate' },
  { key: 'preferences', title: '使用偏好', icon: 'control' }
];
