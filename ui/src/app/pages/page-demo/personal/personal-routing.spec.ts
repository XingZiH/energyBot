import { SKIP_MENU_AUTH } from '@core/services/common/guard/route-auth-data';

import personalRoutes from './personal-routing';

describe('personal self-service routes', () => {
  it('allows logged-in users to open profile pages without menu authorization', () => {
    const personalCenter = personalRoutes.find(route => route.path === 'personal-center');
    const personalSetting = personalRoutes.find(route => route.path === 'personal-setting');

    expect(personalCenter?.data?.[SKIP_MENU_AUTH]).toBeTrue();
    expect(personalSetting?.data?.[SKIP_MENU_AUTH]).toBeTrue();
  });
});
