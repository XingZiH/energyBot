import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import { EnergyLinkTestResult, EnergyLinkTestStep, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';
import { fnCheckForm } from '@utils/tools';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzStepsModule } from 'ng-zorro-antd/steps';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTagModule } from 'ng-zorro-antd/tag';

const CATFEE_MIN_ENERGY_AMOUNT = 65000;

@Component({
  selector: 'app-energy-rental-link-test',
  templateUrl: './link-test.component.html',
  styleUrl: './link-test.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    ReactiveFormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzDescriptionsModule,
    NzFormModule,
    NzGridModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzSpinModule,
    NzStepsModule,
    NzSwitchModule,
    NzTagModule
  ]
})
export class EnergyRentalLinkTestComponent {
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '链路测试',
    breadcrumb: ['首页', '机器人控制', '链路测试'],
    desc: '专门用于 CatFee Nile 测试环境的配置、账户、预估价格和真实下单检查。'
  };
  readonly loading = signal(false);
  readonly result = signal<EnergyLinkTestResult | null>(null);
  readonly currentStep = computed(() => {
    const steps = this.result()?.steps ?? [];
    const failedIndex = steps.findIndex(item => item.status === 'failed');
    if (failedIndex >= 0) {
      return failedIndex;
    }
    return Math.max(steps.length - 1, 0);
  });
  readonly stepsStatus = computed(() => (this.result()?.overallStatus === 'failed' ? 'error' : 'finish'));
  readonly form = inject(FormBuilder).nonNullable.group({
    energyAmount: [CATFEE_MIN_ENERGY_AMOUNT, [Validators.required, Validators.min(CATFEE_MIN_ENERGY_AMOUNT)]],
    durationHours: [1, [Validators.required]],
    createOrder: [false],
    receiverAddress: [''],
    clientOrderId: ['', [Validators.maxLength(64)]]
  });

  private dataService = inject(EnergyRentalService);
  private destroyRef = inject(DestroyRef);

  constructor() {
    this.form.controls.createOrder.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(enabled => {
      const receiverControl = this.form.controls.receiverAddress;
      receiverControl.setValidators(enabled ? [Validators.required, Validators.pattern(/^T[a-zA-Z0-9]{20,}$/)] : []);
      receiverControl.updateValueAndValidity({ emitEvent: false });
    });
  }

  runTest(): void {
    if (!fnCheckForm(this.form)) {
      return;
    }
    this.loading.set(true);
    this.dataService
      .runLinkTest(this.form.getRawValue())
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => {
        this.result.set(data);
      });
  }

  statusColor(status?: string): string {
    const colorMap: Record<string, string> = {
      success: 'success',
      warning: 'warning',
      failed: 'error'
    };
    return status ? colorMap[status] || 'default' : 'default';
  }

  statusText(status?: string): string {
    const textMap: Record<string, string> = {
      success: '通过',
      warning: '警告',
      failed: '失败'
    };
    return status ? textMap[status] || status : '-';
  }

  environmentText(environment?: string): string {
    return environment === 'nile' ? 'Nile 测试环境' : environment || '-';
  }

  createOrderEnabled(): boolean {
    return this.form.controls.createOrder.value === true;
  }

  formatTrx(value?: number | string | null): string {
    const amount = Number(value ?? 0);
    return `${Number.isFinite(amount) ? amount.toFixed(6) : '0.000000'} TRX`;
  }

  detailEntries(step: EnergyLinkTestStep): Array<{ label: string; value: string }> {
    return Object.entries(step.details ?? {}).map(([key, value]) => ({
      label: this.detailLabel(key),
      value: this.detailValue(value)
    }));
  }

  private detailLabel(key: string): string {
    const labels: Record<string, string> = {
      activeEnvironment: '当前后台环境',
      activeProvider: '当前服务商',
      activateAmountSun: '激活费 SUN',
      activateAmountTrx: '激活费 TRX',
      activateStatus: '激活状态',
      apiBaseUrl: 'API 地址',
      autoActivate: '自动激活',
      balanceSun: '余额 SUN',
      balanceTrx: '余额 TRX',
      balanceUsdt: 'USDT 余额',
      balanceUsdtSun: 'USDT 余额 SUN',
      costSun: '预估成本 SUN',
      costTrx: '预估成本 TRX',
      clientOrderId: '客户端订单号',
      confirmStatus: '确认状态',
      delegateHash: '委托哈希',
      duration: '订单时长',
      expiredTimestamp: '到期时间戳',
      id: '订单 ID',
      keyConfigured: 'Key 状态',
      payAmountSun: '扣费 SUN',
      payAmountTrx: '扣费 TRX',
      quantity: '能量数量',
      rechargeAddress: '充值地址',
      receiver: '接收地址',
      reclaimHash: '回收哈希',
      requestPath: '请求路径',
      resourceType: '资源类型',
      secretConfigured: 'Secret 状态',
      sourceType: '来源类型',
      stakedSun: '质押 SUN',
      status: '订单状态',
      wallet: '账户钱包',
      whitelist: 'IP 白名单'
    };
    return labels[key] || key;
  }

  private detailValue(value: string | number | boolean | null | undefined): string {
    if (typeof value === 'boolean') {
      return value ? '是' : '否';
    }
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    return String(value);
  }
}
