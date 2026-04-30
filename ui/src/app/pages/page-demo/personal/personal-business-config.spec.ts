import { PERSONAL_CENTER_QUICK_ACTIONS, PERSONAL_SETTING_SECTIONS, getPersonalCenterQuickActions } from './personal-business-config';

describe('personal business page configuration', () => {
  it('uses energy rental business actions instead of demo profile content', () => {
    expect(PERSONAL_CENTER_QUICK_ACTIONS.map(item => item.label)).toEqual([
      '用户充值',
      '机器人配置',
      '套餐配置',
      '地址管理',
      '订单管理',
      '钱包流水'
    ]);
    expect(PERSONAL_CENTER_QUICK_ACTIONS.map(item => item.route)).toEqual([
      '/default/energy-rental/agent-recharge',
      '/default/energy-rental/bot-config',
      '/default/energy-rental/packages',
      '/default/energy-rental/address-management',
      '/default/energy-rental/orders',
      '/default/energy-rental/wallet-transactions'
    ]);
  });

  it('hides user recharge quick action for administrators', () => {
    expect(
      getPersonalCenterQuickActions(['default:energy-rental:platform-config']).map(item => item.label)
    ).not.toContain('用户充值');
    expect(getPersonalCenterQuickActions(['default:energy-rental:agent-recharge']).map(item => item.label)).toContain('用户充值');
  });

  it('exposes account settings sections that are usable by normal users', () => {
    expect(PERSONAL_SETTING_SECTIONS.map(item => item.key)).toEqual(['profile', 'security', 'preferences']);
    expect(PERSONAL_SETTING_SECTIONS.map(item => item.title)).toEqual(['账户资料', '安全设置', '使用偏好']);
  });
});
