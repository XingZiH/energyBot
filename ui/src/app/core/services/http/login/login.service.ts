import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

// import { MENU_TOKEN } from '@config/menu';
import { Menu } from '@core/services/types';
import { BaseHttpService } from '@services/base-http.service';
// import { MenusService } from '@services/system/menus.service';

export interface UserLogin {
  userName: string;
  password: string;
}

export interface UserSignup extends UserLogin {
  agentName?: string;
  mobile?: string;
  email?: string;
}

/**
 * signup 接口响应。
 *
 * 后端在注册成功时同事务开通了 customer + license，licenseSecret 明文**只在此次响应
 * 中出现**；前端必须立即展示并提醒用户保存。后续只能通过「我的 License」→ reveal
 * 拿回 installCommand，不会再有明文 secret。
 */
export interface UserSignupResult {
  userId: number;
  agentId: number;
  customerId: number;
  licenseKey: string;
  licenseSecret: string;
  installCommand: string;
}

@Injectable({
  providedIn: 'root'
})
export class LoginService {
  http = inject(BaseHttpService);
  // private menus = inject(MENU_TOKEN);

  public login(params: UserLogin): Observable<string> {
    return this.http.post('/auth/signin', params, { needSuccessInfo: false });
  }

  public signup(params: UserSignup): Observable<UserSignupResult> {
    return this.http.post('/auth/signup', params, { needSuccessInfo: true });
  }

  public loginOut(): Observable<string> {
    return this.http.post('/auth/signout', null, { needSuccessInfo: false });
  }

  public getMenuByUserAuthCode(userAuthCode: string[]): Observable<Menu[]> {
    return this.http.post(`/auth/menu`, userAuthCode);
  }
}
