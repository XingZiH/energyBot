import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { interval } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { AgentAccount, AgentRechargeOrder, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzQRCodeModule } from 'ng-zorro-antd/qr-code';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzStatisticModule } from 'ng-zorro-antd/statistic';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';

import { buildAgentRechargeQrValue, formatTrxAmount } from './agent-recharge-payment';

@Component({
  selector: 'app-energy-rental-agent-recharge',
  templateUrl: './agent-recharge.component.html',
  styleUrl: './agent-recharge.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    FormsModule,
    NzButtonModule,
    NzCardModule,
    NzGridModule,
    NzIconModule,
    NzInputNumberModule,
    NzModalModule,
    NzQRCodeModule,
    NzSpinModule,
    NzStatisticModule,
    NzTableModule,
    NzTagModule
  ]
})
export class EnergyRentalAgentRechargeComponent implements OnInit {
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '用户充值',
    breadcrumb: ['首页', '机器人控制', '用户充值'],
    desc: '创建 TRX 充值订单，按订单金额完成转账后系统自动入账。'
  };
  readonly loading = signal(false);
  readonly creating = signal(false);
  readonly syncingOrderId = signal<number | null>(null);
  readonly account = signal<AgentAccount | null>(null);
  readonly rechargeOrders = signal<AgentRechargeOrder[]>([]);
  readonly amountTrx = signal<number | null>(null);
  readonly payOrder = signal<AgentRechargeOrder | null>(null);
  readonly now = signal(Date.now());

  private dataService = inject(EnergyRentalService);
  private destroyRef = inject(DestroyRef);
  private message = inject(NzMessageService);
  private modal = inject(NzModalService);

  formatSun(value: string | number | null | undefined): string {
    return `${this.formatTrxAmount(value)} TRX`;
  }

  formatTrxAmount(value: string | number | null | undefined): string {
    return formatTrxAmount(value);
  }

  paymentQrValue(order: AgentRechargeOrder): string {
    return buildAgentRechargeQrValue(order);
  }

  statusColor(status: string): string {
    const map: Record<string, string> = {
      creating: 'blue',
      pending: 'orange',
      confirmed: 'green',
      cancelled: 'default',
      expired: 'red',
      failed: 'red'
    };
    return map[status] ?? 'default';
  }

  statusText(status: string): string {
    const map: Record<string, string> = {
      creating: '创建中',
      pending: '待付款',
      confirmed: '已入账',
      cancelled: '已取消',
      expired: '已过期',
      failed: '失败'
    };
    return map[status] ?? status;
  }

  invoiceStatusText(status?: string): string {
    const map: Record<string, string> = {
      pending: '待付款',
      paid: '已付款',
      unconfirmed: '待链上确认',
      confirmed: '链上已确认',
      onchain_confirmed: '链上已确认',
      complete: '已完成',
      expired: '已过期',
      invalid: '异常',
      refunded: '已退款'
    };
    return map[String(status || '')] ?? status ?? '-';
  }

  shortText(value?: string): string {
    const text = String(value || '').trim();
    return text.length > 18 ? `${text.slice(0, 8)}...${text.slice(-6)}` : text || '-';
  }

  effectiveStatus(order: AgentRechargeOrder): string {
    return this.isExpired(order) && this.isWaitingForPayment(order) ? 'expired' : order.status;
  }

  formatDateTime(value?: string): string {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return '-';
    }
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  isWaitingForPayment(order: AgentRechargeOrder): boolean {
    return order.status === 'pending' || order.status === 'creating';
  }

  isExpired(order: AgentRechargeOrder): boolean {
    if (!order.expiresAt) {
      return false;
    }
    const expiresAt = new Date(order.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= this.now();
  }

  isPayable(order: AgentRechargeOrder): boolean {
    return this.isWaitingForPayment(order) && !this.isExpired(order) && !!String(order.paymentAddress || '').trim();
  }

  canSync(order: AgentRechargeOrder): boolean {
    return !['confirmed', 'expired', 'failed', 'cancelled'].includes(this.effectiveStatus(order));
  }

  remainingText(order: AgentRechargeOrder): string {
    if (!order.expiresAt) {
      return '-';
    }
    const expiresAt = new Date(order.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) {
      return '-';
    }
    const remainingSeconds = Math.max(0, Math.floor((expiresAt - this.now()) / 1000));
    if (remainingSeconds <= 0) {
      return '已过期';
    }
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    const parts = hours > 0 ? [hours, minutes, seconds] : [minutes, seconds];
    return parts.map(item => String(item).padStart(2, '0')).join(':');
  }

  openCheckout(order: AgentRechargeOrder): void {
    if (this.isExpired(order)) {
      this.message.warning('当前充值订单已过期，请重新创建订单后再付款');
      return;
    }
    if (!this.isPayable(order)) {
      this.message.warning('当前订单暂未生成付款地址，请先同步订单状态');
      return;
    }
    this.payOrder.set(order);
  }

  closePaymentModal(): void {
    this.payOrder.set(null);
  }

  copyText(label: string, value?: string | number | null): void {
    const text = String(value ?? '').trim();
    if (!text) {
      this.message.warning(`${label}为空，无法复制`);
      return;
    }
    const done = () => this.message.success(`${label}已复制`);
    const failed = () => this.message.error(`${label}复制失败，请手动复制`);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(failed);
      return;
    }
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.focus();
    input.select();
    try {
      document.execCommand('copy') ? done() : failed();
    } catch {
      failed();
    } finally {
      document.body.removeChild(input);
    }
  }

  reload(): void {
    this.loading.set(true);
    this.dataService
      .getAgentAccount()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(account => this.account.set(account));
    this.dataService
      .getAgentRechargeOrders({ pageIndex: 1, pageSize: 20, filters: {} })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => this.rechargeOrders.set(data.list || []));
  }

  createRechargeOrder(): void {
    const amountTrx = Number(this.amountTrx() || 0);
    if (!Number.isFinite(amountTrx) || amountTrx <= 0) {
      this.message.warning('请输入大于 0 的充值金额');
      return;
    }
    this.creating.set(true);
    this.dataService
      .createAgentRechargeOrder({ amountTrx })
      .pipe(
        finalize(() => this.creating.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(order => {
        this.amountTrx.set(null);
        if (this.isPayable(order)) {
          this.payOrder.set(order);
          this.message.success('充值订单已创建，请在有效期内完成转账');
        } else {
          this.modal.info({
            nzTitle: `充值订单 ${order.orderNo} 已创建`,
            nzContent: '付款地址生成中，请稍后同步订单状态后查看付款信息。',
            nzOkText: '知道了'
          });
        }
        this.reload();
      });
  }

  syncRecharge(order: AgentRechargeOrder): void {
    this.syncingOrderId.set(order.id);
    this.dataService
      .syncAgentRechargeOrder(order.id)
      .pipe(
        finalize(() => this.syncingOrderId.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(result => {
        this.showSyncResult(result);
        if (result.status === 'confirmed' || result.status === 'expired' || result.credited) {
          this.closePaymentModal();
        }
        this.reload();
      });
  }

  ngOnInit(): void {
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
    this.reload();
  }

  private showSyncResult(result: { credited: boolean; status: string }): void {
    if (result.credited || result.status === 'confirmed' || result.status === 'complete') {
      this.message.success('已确认付款，充值余额已入账');
      return;
    }
    const map: Record<string, { type: 'info' | 'warning' | 'error'; text: string }> = {
      pending: { type: 'info', text: '暂未检测到付款，请完成转账后稍后再同步' },
      unconfirmed: { type: 'info', text: '已检测到链上付款，正在等待确认' },
      paid: { type: 'info', text: '已检测到付款，正在等待链上确认' },
      expired: { type: 'warning', text: '充值订单已过期，请重新创建订单后再付款' },
      invalid: { type: 'error', text: '收款状态异常，请联系管理员处理' },
      failed: { type: 'error', text: '收款状态异常，请联系管理员处理' }
    };
    const message = map[result.status] ?? {
      type: 'info' as const,
      text: `当前收款状态：${this.invoiceStatusText(result.status)}`
    };
    this.message[message.type](message.text);
  }
}
