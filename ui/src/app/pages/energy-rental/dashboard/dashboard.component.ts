import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import {
  EnergyRentalDashboard,
  EnergyRentalService,
  ProviderBalanceMonitor,
  ProviderRechargePreview
} from '@services/energy-rental/energy-rental.service';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
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
    FormsModule,
    NzButtonModule,
    NzCardModule,
    NzDescriptionsModule,
    NzGridModule,
    NzStatisticModule,
    NzSpinModule,
    NzTagModule,
    NzIconModule,
    NzInputModule,
    NzModalModule
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
  readonly rechargeAmountTrx = signal<number | null>(null);
  readonly rechargePreview = signal<ProviderRechargePreview | null>(null);
  readonly previewingRecharge = signal(false);
  readonly recharging = signal(false);
  readonly refreshingProviderBalance = signal(false);
  readonly providerBalancePolling = signal(false);

  @ViewChild('rechargeConfirmTpl', { static: true })
  private rechargeConfirmTpl!: TemplateRef<unknown>;

  private dataService = inject(EnergyRentalService);
  private destroyRef = inject(DestroyRef);
  private message = inject(NzMessageService);
  private modal = inject(NzModalService);
  private providerBalancePollTimer: ReturnType<typeof setTimeout> | null = null;
  private providerBalancePollBaseTrx: number | null = null;
  private providerBalancePollAttempts = 0;
  private readonly providerBalancePollIntervalMs = 10_000;
  private readonly providerBalancePollMaxAttempts = 12;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopProviderBalancePolling());
  }

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

  formatOptionalTrx(value: number | null): string {
    return value === null ? '查询失败' : this.formatTrx(value);
  }

  remainingWalletBalanceTrx(preview: ProviderRechargePreview): number | null {
    return preview.walletBalanceTrx === null ? null : preview.walletBalanceTrx - preview.estimatedTotalTrx;
  }

  formatRemainingWalletBalance(preview: ProviderRechargePreview): string {
    return this.formatOptionalTrx(this.remainingWalletBalanceTrx(preview));
  }

  balanceCheckText(value: boolean | null): string {
    if (value === true) return '可以转账';
    if (value === false) return '余额不足';
    return '未确认';
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

  canRecharge(item: ProviderBalanceMonitor): boolean {
    return (
      item.provider === 'catfee' &&
      item.channel === 'prod' &&
      !!item.rechargeAddress &&
      !this.previewingRecharge() &&
      !this.recharging()
    );
  }

  onRechargeAmountChange(value: string | number | null): void {
    const parsed = Number(value ?? 0);
    this.rechargeAmountTrx.set(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    this.rechargePreview.set(null);
  }

  confirmRechargeProvider(item: ProviderBalanceMonitor): void {
    const amountTrx = Number(this.rechargeAmountTrx() || 0);
    if (!Number.isFinite(amountTrx) || amountTrx <= 0) {
      this.message.warning('请输入大于 0 的充值金额');
      return;
    }
    if (!this.canRecharge(item)) {
      this.message.warning('当前服务商暂不能发起充值');
      return;
    }

    this.previewingRecharge.set(true);
    this.dataService
      .previewProviderRecharge({
        provider: item.provider,
        amountTrx
      })
      .pipe(
        finalize(() => this.previewingRecharge.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(preview => {
        this.rechargePreview.set(preview);
        if (preview.hasEnoughBalance === false) {
          this.message.error(
            `平台钱包余额不足，预计扣款 ${this.formatTrx(preview.estimatedTotalTrx)}，当前余额 ${this.formatOptionalTrx(preview.walletBalanceTrx)}`
          );
          return;
        }
        this.modal.confirm({
          nzTitle: '确认充值到 CatFee 中？',
          nzContent: this.rechargeConfirmTpl,
          nzWidth: 860,
          nzOkText: '确认转账',
          nzCancelText: '取消',
          nzOnOk: () => this.executeRecharge(item)
        });
      });
  }

  private executeRecharge(item: ProviderBalanceMonitor): void {
    const amountTrx = Number(this.rechargeAmountTrx() || 0);
    if (!Number.isFinite(amountTrx) || amountTrx <= 0) {
      this.message.warning('请输入大于 0 的充值金额');
      return;
    }
    this.recharging.set(true);
    this.dataService
      .rechargeProviderBalance({
        provider: item.provider,
        amountTrx
      })
      .pipe(
        finalize(() => this.recharging.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(result => {
        this.message.success(`充值转账已提交：${result.txHash}，预计总扣款 ${this.formatTrx(result.estimatedTotalTrx)}`);
        this.rechargeAmountTrx.set(null);
        this.rechargePreview.set(null);
        this.reload();
        this.startProviderBalancePolling();
      });
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

  private startProviderBalancePolling(): void {
    this.stopProviderBalancePolling();
    this.providerBalancePollBaseTrx = this.primaryBalanceMonitor()?.balanceTrx ?? null;
    this.providerBalancePollAttempts = 0;
    this.providerBalancePolling.set(true);
    this.message.info('已提交转账，正在自动检测 CatFee 生产余额到账状态');
    this.scheduleProviderBalancePoll(3_000);
  }

  private scheduleProviderBalancePoll(delayMs: number): void {
    this.providerBalancePollTimer = setTimeout(() => this.pollProviderBalanceOnce(), delayMs);
  }

  private pollProviderBalanceOnce(): void {
    this.providerBalancePollAttempts += 1;
    this.refreshingProviderBalance.set(true);
    this.dataService
      .getDashboard()
      .pipe(
        finalize(() => this.refreshingProviderBalance.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: data => {
          this.dashboard.set(data);
          const currentBalance = this.primaryBalanceMonitor()?.balanceTrx ?? null;
          const baseBalance = this.providerBalancePollBaseTrx;
          const hasBalanceUpdated = baseBalance !== null && currentBalance !== null && currentBalance > baseBalance + 0.000001;

          if (hasBalanceUpdated) {
            this.stopProviderBalancePolling();
            this.message.success(`CatFee 生产余额已更新：${this.formatTrx(currentBalance)}`);
            return;
          }

          if (this.providerBalancePollAttempts >= this.providerBalancePollMaxAttempts) {
            this.stopProviderBalancePolling();
            this.message.warning('暂未检测到 CatFee 余额变化，请稍后点击刷新余额再次确认');
            return;
          }

          this.scheduleProviderBalancePoll(this.providerBalancePollIntervalMs);
        },
        error: () => {
          this.stopProviderBalancePolling();
          this.message.warning('自动检测 CatFee 余额失败，请稍后点击刷新余额再次确认');
        }
      });
  }

  private stopProviderBalancePolling(): void {
    if (this.providerBalancePollTimer) {
      clearTimeout(this.providerBalancePollTimer);
      this.providerBalancePollTimer = null;
    }
    this.providerBalancePolling.set(false);
  }
}
