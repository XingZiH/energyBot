import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, finalize } from 'rxjs/operators';
import { forkJoin, Observable, of } from 'rxjs';

import { WindowService } from '@core/services/common/window.service';
import {
  AgentAccount,
  AgentBotConfig,
  EnergyRentalDashboard,
  EnergyRentalOrder,
  EnergyRentalService,
  EnergyUserAddressStats
} from '@services/energy-rental/energy-rental.service';
import { UserInfoStoreService } from '@store/common-store/userInfo-store.service';

import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzStatisticModule } from 'ng-zorro-antd/statistic';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTypographyModule } from 'ng-zorro-antd/typography';

import {
  DEFAULT_PERSONAL_PREFERENCES,
  PERSONAL_PREFERENCE_STORAGE_KEY,
  PersonalPreference,
  getPersonalCenterQuickActions
} from '../personal-business-config';

@Component({
  selector: 'app-personal-center',
  templateUrl: './personal-center.component.html',
  styleUrl: './personal-center.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NzGridModule,
    NzCardModule,
    NzAvatarModule,
    NzTypographyModule,
    NzIconModule,
    NzButtonModule,
    NzDividerModule,
    NzTagModule,
    NzStatisticModule,
    NzDescriptionsModule,
    NzSpinModule,
    NzTableModule
  ]
})
export class PersonalCenterComponent implements OnInit {
  readonly loading = signal(false);
  readonly dashboard = signal<EnergyRentalDashboard | null>(null);
  readonly account = signal<AgentAccount | null>(null);
  readonly botConfig = signal<AgentBotConfig | null>(null);
  readonly recentOrders = signal<EnergyRentalOrder[]>([]);
  readonly addresses = signal<EnergyUserAddressStats[]>([]);
  readonly preferences = signal<PersonalPreference>({ ...DEFAULT_PERSONAL_PREFERENCES });
  readonly userInfo = computed(() => this.userInfoService.$userInfo());
  readonly quickActions = computed(() => getPersonalCenterQuickActions(this.userInfo().authCode || []));

  private readonly dataService = inject(EnergyRentalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly userInfoService = inject(UserInfoStoreService);
  private readonly windowService = inject(WindowService);

  userRoleLabel(): string {
    const authCodes = this.userInfo().authCode || [];
    return authCodes.some(code => code.includes('system') || code.includes('platform-config')) ? '管理员' : '用户';
  }

  botStatusText(): string {
    if (!this.botConfig()) return '未加载';
    if (this.botConfig()?.botStatus === 'enabled') return '已启用';
    return '未启用';
  }

  botStatusColor(): string {
    return this.botConfig()?.botStatus === 'enabled' ? 'green' : 'default';
  }

  defaultAddress(): EnergyUserAddressStats | null {
    return this.addresses().find(item => item.isDefault) ?? this.addresses()[0] ?? null;
  }

  activeAddressCount(): number {
    return this.addresses().filter(item => item.status !== 'disabled').length;
  }

  sunToTrx(value?: string | number | null, precision = 4): string {
    const sun = Number(value || 0);
    return `${(sun / 1_000_000).toFixed(precision)} TRX`;
  }

  numberText(value?: string | number | null): string {
    return Number(value || 0).toLocaleString('zh-CN');
  }

  statusColor(status?: string): string {
    const colorMap: Record<string, string> = {
      pending: 'orange',
      paid: 'blue',
      renting: 'processing',
      completed: 'green',
      failed: 'red',
      cancelled: 'default'
    };
    return status ? colorMap[status] || 'default' : 'default';
  }

  statusText(status?: string): string {
    const textMap: Record<string, string> = {
      pending: '待支付',
      paid: '已支付',
      renting: '租赁中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消'
    };
    return status ? textMap[status] || status : '-';
  }

  shortAddress(value?: string): string {
    const address = String(value || '').trim();
    return address.length > 18 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address || '-';
  }

  navigate(route: string): void {
    this.router.navigateByUrl(route);
  }

  reload(): void {
    this.loadPreferences();
    this.loading.set(true);
    forkJoin({
      dashboard: this.safeRequest(this.dataService.getDashboard(), null),
      account: this.safeRequest(this.dataService.getAgentAccount(), null),
      botConfig: this.safeRequest(this.dataService.getAgentBotConfig(), null),
      orders: this.safeRequest(this.dataService.getOrders({ pageIndex: 1, pageSize: 5, filters: {} }), null),
      addresses: this.safeRequest(this.dataService.getAddresses({ pageIndex: 1, pageSize: 5, filters: {} }), null)
    })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ dashboard, account, botConfig, orders, addresses }) => {
        this.dashboard.set(dashboard);
        this.account.set(account);
        this.botConfig.set(botConfig);
        this.recentOrders.set(orders?.list ?? []);
        this.addresses.set(addresses?.list ?? []);
      });
  }

  ngOnInit(): void {
    this.reload();
  }

  private safeRequest<T>(request$: Observable<T>, fallback: T): Observable<T> {
    return request$.pipe(catchError(() => of(fallback)));
  }

  private loadPreferences(): void {
    const raw = this.windowService.getStorage(PERSONAL_PREFERENCE_STORAGE_KEY);
    if (!raw) {
      this.preferences.set({ ...DEFAULT_PERSONAL_PREFERENCES });
      return;
    }
    try {
      this.preferences.set({ ...DEFAULT_PERSONAL_PREFERENCES, ...(JSON.parse(raw) as Partial<PersonalPreference>) });
    } catch {
      this.windowService.removeStorage(PERSONAL_PREFERENCE_STORAGE_KEY);
      this.preferences.set({ ...DEFAULT_PERSONAL_PREFERENCES });
    }
  }
}
