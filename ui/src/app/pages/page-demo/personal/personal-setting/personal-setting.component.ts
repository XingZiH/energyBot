import { BreakpointObserver } from '@angular/cdk/layout';

import { Component, OnInit, ChangeDetectionStrategy, computed, inject, DestroyRef, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { LoginInOutService } from '@core/services/common/login-in-out.service';
import { WindowService } from '@core/services/common/window.service';
import { AccountService, UserPsd } from '@services/system/account.service';
import { UserInfoStoreService } from '@store/common-store/userInfo-store.service';
import { ModalBtnStatus } from '@widget/base-modal';
import { ChangePasswordService } from '@widget/biz-widget/change-password/change-password.service';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMenuModeType, NzMenuModule } from 'ng-zorro-antd/menu';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTypographyModule } from 'ng-zorro-antd/typography';

import {
  DEFAULT_PERSONAL_PREFERENCES,
  PERSONAL_PREFERENCE_STORAGE_KEY,
  PERSONAL_SETTING_SECTIONS,
  PersonalPreference,
  PersonalSettingSection
} from '../personal-business-config';

@Component({
  selector: 'app-personal-setting',
  templateUrl: './personal-setting.component.html',
  styleUrl: './personal-setting.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NzMenuModule, NzButtonModule, NzTypographyModule, NzDescriptionsModule, NzIconModule, NzSwitchModule, NzTagModule]
})
export class PersonalSettingComponent implements OnInit {
  readonly sections = PERSONAL_SETTING_SECTIONS;
  tabModel = signal<NzMenuModeType>('inline');
  activeSection = signal<PersonalSettingSection['key']>('profile');
  preferences = signal<PersonalPreference>({ ...DEFAULT_PERSONAL_PREFERENCES });
  destroyRef = inject(DestroyRef);
  readonly userInfo = computed(() => this.userInfoService.$userInfo());
  readonly currentTitle = computed(() => this.sections.find(item => item.key === this.activeSection())?.title || '账户资料');

  private breakpointObserver = inject(BreakpointObserver);
  private userInfoService = inject(UserInfoStoreService);
  private changePasswordModalService = inject(ChangePasswordService);
  private accountService = inject(AccountService);
  private loginOutService = inject(LoginInOutService);
  private windowService = inject(WindowService);
  private message = inject(NzMessageService);
  private router = inject(Router);

  selectSection(item: PersonalSettingSection): void {
    this.activeSection.set(item.key);
  }

  isActiveSection(item: PersonalSettingSection): boolean {
    return this.activeSection() === item.key;
  }

  userRoleLabel(): string {
    const authCodes = this.userInfo().authCode || [];
    return authCodes.some(code => code.includes('system') || code.includes('platform-config')) ? '管理员' : '用户';
  }

  navigate(route: string): void {
    this.router.navigateByUrl(route);
  }

  changePassword(): void {
    this.changePasswordModalService.show({ nzTitle: '修改密码' }).subscribe(({ modalValue, status }) => {
      if (status === ModalBtnStatus.Cancel) {
        return;
      }
      const user: UserPsd = {
        id: this.userInfo().userId,
        oldPassword: modalValue.oldPassword,
        newPassword: modalValue.newPassword
      };
      this.accountService.editAccountPsd(user).subscribe(() => {
        this.loginOutService.loginOut().then();
        this.message.success('密码修改成功，请重新登录');
      });
    });
  }

  clearLocalCache(): void {
    this.windowService.clearStorage();
    this.windowService.clearSessionStorage();
    this.loginOutService.loginOut().then();
    this.message.success('缓存已清理，请重新登录');
  }

  updatePreference(key: keyof PersonalPreference, value: boolean): void {
    this.preferences.update(current => {
      const next = { ...current, [key]: value };
      this.windowService.setStorage(PERSONAL_PREFERENCE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  obBreakPoint(): void {
    this.breakpointObserver
      .observe(['(max-width: 767px)'])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(result => {
        this.tabModel.set(result.matches ? 'horizontal' : 'inline');
      });
  }

  ngOnInit(): void {
    this.loadPreferences();
    this.obBreakPoint();
  }

  private loadPreferences(): void {
    const raw = this.windowService.getStorage(PERSONAL_PREFERENCE_STORAGE_KEY);
    if (!raw) {
      this.preferences.set({ ...DEFAULT_PERSONAL_PREFERENCES });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<PersonalPreference>;
      this.preferences.set({ ...DEFAULT_PERSONAL_PREFERENCES, ...parsed });
    } catch {
      this.windowService.removeStorage(PERSONAL_PREFERENCE_STORAGE_KEY);
      this.preferences.set({ ...DEFAULT_PERSONAL_PREFERENCES });
    }
  }
}
