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

@Injectable({
  providedIn: 'root'
})
export class LoginService {
  http = inject(BaseHttpService);
  // private menus = inject(MENU_TOKEN);

  public login(params: UserLogin): Observable<string> {
    return this.http.post('/auth/signin', params, { needSuccessInfo: false });
  }

  public signup(params: UserSignup): Observable<{ userId: number; agentId: number }> {
    return this.http.post('/auth/signup', params, { needSuccessInfo: true });
  }

  public loginOut(): Observable<string> {
    return this.http.post('/auth/signout', null, { needSuccessInfo: false });
  }

  public getMenuByUserAuthCode(userAuthCode: string[]): Observable<Menu[]> {
    return this.http.post(`/auth/menu`, userAuthCode);
  }
}
