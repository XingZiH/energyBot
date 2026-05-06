import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';

import { EnergyRentalDashboard, EnergyRentalService, ProviderBalanceMonitor } from '@services/energy-rental/energy-rental.service';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzStatisticModule } from 'ng-zorro-antd/statistic';
import { NzTagModule } from 'ng-zorro-antd/tag';

@Component({
  selector: 'app-energy-rental-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    NzButtonModule,
    NzCardModule,
    NzGridModule,
    NzStatisticModule,
    NzSpinModule,
    NzTagModule,
    NzIconModule
  ]
})
export class EnergyRentalDashboardComponent implements OnInit {
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '机器人控制台',
    breadcrumb: ['首页', '机器人控制', '控制台'],
    desc: '查看订单状态、结算收入和服务商账户余额。'
  };
  readonly dashboard = signal<EnergyRentalDashboard | null>(null);
  readonly loading = signal(false);
  readonly refreshingProviderBalance = signal(false);

  private dataService = inject(EnergyRentalService);
  private destroyRef = inject(DestroyRef);
  private message = inject(NzMessageService);

  value(key: keyof EnergyRentalDashboard): string | number {
    const data = this.dashboard();
    const raw = data ? data[key] : '-';
    return Array.isArray(raw) ? raw.length : (raw ?? '-');
  }

  balanceMonitors(): ProviderBalanceMonitor[] {
    return this.dashboard()?.providerBalanceMonitors ?? [];
  }

  isAgentDashboard(): boolean {
    return this.dashboard()?.scope === 'agent';
  }

  primaryBalanceMonitor(): ProviderBalanceMonitor | null {
    return this.balanceMonitors()[0] ?? null;
  }

  serviceBalanceValue(): string {
    if (this.isAgentDashboard()) {
      return this.sunToTrx(this.dashboard()?.agentWalletBalanceSun ?? 0);
    }
    const monitor = this.primaryBalanceMonitor();
    return monitor ? this.formatTrx(monitor.balanceTrx) : '-';
  }

  balanceStatusColor(status: string): string {
    const colorMap: Record<string, string> = {
      ok: 'green',
      warning: 'orange',
      error: 'red',
      unconfigured: 'default'
    };
    return colorMap[status] ?? 'default';
  }

  balanceStatusText(status: string): string {
    const textMap: Record<string, string> = {
      ok: '余额正常',
      warning: '余额不足',
      error: '查询失败',
      unconfigured: '未配置'
    };
    return textMap[status] ?? '未知状态';
  }

  alertThresholdText(item: ProviderBalanceMonitor): string {
    return Number(item.alertThresholdTrx || 0) > 0 ? this.formatTrx(item.alertThresholdTrx) : '未设置';
  }

  formatTrx(value: string | number): string {
    const trx = Number(value || 0);
    return `${trx.toFixed(4)} TRX`;
  }

  sunToTrx(value: string | number): string {
    const sun = Number(value || 0);
    return this.formatTrx(sun / 1_000_000);
  }

  shortAddress(value?: string): string {
    const address = String(value ?? '').trim();
    if (!address) return '-';
    if (address.length <= 18) return address;
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  }

  refreshProviderBalance(showMessage = true): void {
    if (this.refreshingProviderBalance()) return;
    this.refreshingProviderBalance.set(true);
    this.dataService
      .getDashboard()
      .pipe(
        finalize(() => this.refreshingProviderBalance.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => {
        this.dashboard.set(data);
        if (showMessage) {
          this.message.success('服务商余额已刷新');
        }
      });
  }

  reload(): void {
    this.loading.set(true);
    this.dataService
      .getDashboard()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => {
        this.dashboard.set(data);
      });
  }

  ngOnInit(): void {
    this.reload();
  }
}
