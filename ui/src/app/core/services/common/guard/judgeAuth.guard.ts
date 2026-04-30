import { computed, inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router, CanActivateChildFn } from '@angular/router';
import { Observable } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { LoginInOutService } from '@core/services/common/login-in-out.service';
import { MenuStoreService } from '@store/common-store/menu-store.service';
import { UserInfoStoreService } from '@store/common-store/userInfo-store.service';
import { fnGetUUID } from '@utils/tools';
import { fnFlatDataHasParentToTree } from '@utils/treeTableTools';

import { NzMessageService } from 'ng-zorro-antd/message';

import { Menu } from '../../types';
import { shouldSkipMenuAuth } from './route-auth-data';

// 有兴趣的可以看看class与fn的争议https://github.com/angular/angular/pull/47924
// 我这里提供了跟judgeLogin.guard.ts的不同写法，供大家参考,也可以去官网查找mapToCanActivate 这个api，
// 用于切换路由时判断该用户是否有权限进入该业务页面，如果没有权限则跳转到登录页
@Injectable({
  providedIn: 'root'
})
export class JudgeAuthGuardService {
  selMenu: Menu | null = null;
  loginOutService = inject(LoginInOutService);
  router = inject(Router);
  userInfoService = inject(UserInfoStoreService);
  menuStoreService = inject(MenuStoreService);
  message = inject(NzMessageService);
  authCodeArray = computed(() => this.userInfoService.$userInfo().authCode);
  menuNavList = computed(() => this.menuStoreService.$menuArray());

  // 保存当前的menu到this.selMenu
  getMenu(menu: Menu[], url: string): void {
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let i = 0; i < menu.length; i++) {
      if (url === menu[i].path) {
        this.selMenu = menu[i];
        return;
      } else {
        if (menu[i].children && menu[i].children!.length > 0) {
          this.getMenu(menu[i].children!, url);
        }
      }
    }
  }

  getResult(code: string, authCodeArray: string[]): boolean | UrlTree {
    if (authCodeArray.includes(code)) {
      return true;
    } else {
      this.message.error('您没有权限登录该模块');
      this.loginOutService.loginOut();
      return this.router.parseUrl('/login');
    }
  }

  refreshAuthCodeAndGetResult(code: string): Observable<boolean | UrlTree> {
    const userInfo = this.userInfoService.$userInfo();
    if (userInfo.userId <= 0) {
      return new Observable(observer => {
        observer.next(this.getResult(code, []));
        observer.complete();
      });
    }

    return this.userInfoService.getUserAuthCodeByUserId(userInfo.userId).pipe(
      switchMap(authCode => {
        this.userInfoService.$userInfo.set({ ...userInfo, authCode });
        return this.loginOutService.getMenuByUserAuthCode(authCode).pipe(
          map(menus => {
            const menuTree = fnFlatDataHasParentToTree(
              menus
                .filter(item => item.menuType === 'C')
                .map(item => ({ ...item, selected: false, open: false }))
            );
            this.menuStoreService.setMenuArrayStore(menuTree);
            return this.getResult(code, authCode);
          })
        );
      }),
      catchError(() => {
        return new Observable<boolean | UrlTree>(observer => {
          observer.next(this.getResult(code, []));
          observer.complete();
        });
      })
    );
  }

  canActivateChild(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    while (route.firstChild) {
      route = route.firstChild;
    }
    if (shouldSkipMenuAuth(route.data)) {
      return true;
    }
    // 如果有authCode，则表示是页面上点击按钮跳转到新的路由，而不是菜单中的路由
    if (route.data['authCode']) {
      return this.getResult(route.data['authCode'], this.authCodeArray());
    }

    // 如果是菜单上的按钮，则走下面
    this.selMenu = null;
    this.getMenu(this.menuNavList(), state.url.split('?')[0]);
    // 没找到菜单，直接回登录页
    if (!this.selMenu) {
      return this.getResult(fnGetUUID(), this.authCodeArray());
    }
    const selMenuCode = (this.selMenu as Menu).code;
    this.selMenu = null;
    // 找到了菜单，但是菜单的权限码用户不拥有，则跳转到登录页
    return this.authCodeArray().includes(selMenuCode!) ? true : this.refreshAuthCodeAndGetResult(selMenuCode!);
  }
}

export const JudgeAuthGuard: CanActivateChildFn = (childRoute: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  return inject(JudgeAuthGuardService).canActivateChild(childRoute, state);
};
