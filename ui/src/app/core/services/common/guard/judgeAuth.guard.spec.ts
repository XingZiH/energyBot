import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { of } from 'rxjs';

import { LoginInOutService } from '@core/services/common/login-in-out.service';
import { MenuStoreService } from '@store/common-store/menu-store.service';
import { UserInfoStoreService } from '@store/common-store/userInfo-store.service';

import { NzMessageService } from 'ng-zorro-antd/message';

import { JudgeAuthGuardService } from './judgeAuth.guard';
import { SKIP_MENU_AUTH } from './route-auth-data';

describe('JudgeAuthGuardService', () => {
  let loginOutService: jasmine.SpyObj<Pick<LoginInOutService, 'loginOut' | 'getMenuByUserAuthCode'>>;
  let message: jasmine.SpyObj<Pick<NzMessageService, 'error'>>;
  let deniedUrlTree: UrlTree;

  beforeEach(() => {
    deniedUrlTree = {} as UrlTree;
    loginOutService = jasmine.createSpyObj('LoginInOutService', ['loginOut', 'getMenuByUserAuthCode']);
    loginOutService.getMenuByUserAuthCode.and.returnValue(of([]));
    message = jasmine.createSpyObj('NzMessageService', ['error']);

    TestBed.configureTestingModule({
      providers: [
        JudgeAuthGuardService,
        {
          provide: LoginInOutService,
          useValue: loginOutService
        },
        {
          provide: Router,
          useValue: {
            parseUrl: jasmine.createSpy('parseUrl').and.returnValue(deniedUrlTree)
          }
        },
        {
          provide: UserInfoStoreService,
          useValue: {
            $userInfo: signal({ userId: 100, userName: 'normal-user', authCode: [] }),
            getUserAuthCodeByUserId: jasmine.createSpy('getUserAuthCodeByUserId').and.returnValue(of([]))
          }
        },
        {
          provide: MenuStoreService,
          useValue: {
            $menuArray: signal([]),
            setMenuArrayStore: jasmine.createSpy('setMenuArrayStore')
          }
        },
        {
          provide: NzMessageService,
          useValue: message
        }
      ]
    });
  });

  it('allows logged-in self-service routes without menu authorization', () => {
    const guard = TestBed.inject(JudgeAuthGuardService);
    const route = { data: { [SKIP_MENU_AUTH]: true } } as unknown as ActivatedRouteSnapshot;
    const state = { url: '/default/page-demo/personal/personal-center' } as RouterStateSnapshot;

    expect(guard.canActivateChild(route, state)).toBeTrue();
    expect(message.error).not.toHaveBeenCalled();
    expect(loginOutService.loginOut).not.toHaveBeenCalled();
  });

  it('keeps rejecting routes that are neither in the menu tree nor explicitly exempted', () => {
    const guard = TestBed.inject(JudgeAuthGuardService);
    const route = { data: {} } as ActivatedRouteSnapshot;
    const state = { url: '/default/page-demo/personal/personal-center' } as RouterStateSnapshot;

    expect(guard.canActivateChild(route, state)).toBe(deniedUrlTree);
    expect(message.error).toHaveBeenCalledWith('您没有权限登录该模块');
    expect(loginOutService.loginOut).toHaveBeenCalled();
  });
});
