import { Route } from '@angular/router';

export default [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    title: '控制台',
    data: { key: 'energy-rental-dashboard' },
    loadComponent: () => import('./dashboard/dashboard.component').then(m => m.EnergyRentalDashboardComponent)
  },
  {
    path: 'orders',
    title: '订单管理',
    data: { key: 'energy-rental-orders' },
    loadComponent: () => import('./orders/orders.component').then(m => m.EnergyRentalOrdersComponent)
  },
  {
    path: 'platform-config',
    title: '平台配置',
    data: { key: 'energy-rental-platform-config' },
    loadComponent: () => import('./platform-config/platform-config.component').then(m => m.EnergyRentalPlatformConfigComponent)
  },
  {
    path: 'bot-config',
    title: '机器人配置',
    data: { key: 'energy-rental-bot-config' },
    loadComponent: () => import('./agent-bot-config/agent-bot-config.component').then(m => m.EnergyRentalAgentBotConfigComponent)
  },
  {
    path: 'agent-recharge',
    title: '用户充值',
    data: { key: 'energy-rental-agent-recharge' },
    loadComponent: () => import('./agent-recharge/agent-recharge.component').then(m => m.EnergyRentalAgentRechargeComponent)
  },
  {
    path: 'link-test',
    title: '链路测试',
    data: { key: 'energy-rental-link-test' },
    loadComponent: () => import('./link-test/link-test.component').then(m => m.EnergyRentalLinkTestComponent)
  },
  {
    path: 'packages',
    title: '套餐配置',
    data: { key: 'energy-rental-packages' },
    loadComponent: () => import('./packages/packages.component').then(m => m.EnergyRentalPackagesComponent)
  },
  {
    path: 'address-management',
    title: '地址管理',
    data: { key: 'energy-rental-address-management' },
    loadComponent: () => import('./address-management/address-management.component').then(m => m.EnergyRentalAddressManagementComponent)
  },
  {
    path: 'wallet-transactions',
    title: '钱包流水',
    data: { key: 'energy-rental-wallet-transactions' },
    loadComponent: () => import('./wallet-transactions/wallet-transactions.component').then(m => m.EnergyRentalWalletTransactionsComponent)
  },
  {
    path: 'return-tasks',
    title: '归还任务',
    data: { key: 'energy-rental-return-tasks' },
    loadComponent: () => import('./return-tasks/return-tasks.component').then(m => m.EnergyRentalReturnTasksComponent)
  }
] satisfies Route[];
