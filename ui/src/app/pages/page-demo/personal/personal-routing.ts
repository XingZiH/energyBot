import { Route } from '@angular/router';

import { SKIP_MENU_AUTH } from '@core/services/common/guard/route-auth-data';

export default [
  { path: '', redirectTo: 'personal-center', pathMatch: 'full' },
  {
    path: 'personal-center',
    title: 'menu.default:page-demo:personal:personal-center',
    data: { key: 'personal-center', [SKIP_MENU_AUTH]: true },
    loadComponent: () => import('./personal-center/personal-center.component').then(m => m.PersonalCenterComponent)
  },
  {
    path: 'personal-setting',
    title: 'menu.default:page-demo:personal:personal-setting',
    data: { key: 'personal-setting', [SKIP_MENU_AUTH]: true },
    loadComponent: () => import('./personal-setting/personal-setting.component').then(m => m.PersonalSettingComponent)
  }
] satisfies Route[];
