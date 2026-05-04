import { Route } from '@angular/router';

export default [
  {
    path: '',
    redirectTo: 'my-license',
    pathMatch: 'full',
  },
  {
    path: 'my-license',
    title: 'menu.default:account:my-license',
    data: { key: 'my-license' },
    loadComponent: () =>
      import('./my-license/my-license.component').then(m => m.MyLicenseComponent),
  },
  {
    path: 'my-bot',
    title: 'menu.default:account:my-bot',
    data: { key: 'my-bot' },
    loadComponent: () =>
      import('./my-bot/my-bot.component').then(m => m.MyBotComponent),
  },
] satisfies Route[];
