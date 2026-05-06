import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import { ActionCode } from '@config/actionCode';
import { EnergyPlatformConfig, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';
import { AuthDirective } from '@shared/directives/auth.directive';
import { fnCheckForm } from '@utils/tools';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';

@Component({
  selector: 'app-energy-rental-platform-config',
  templateUrl: './platform-config.component.html',
  styleUrl: './platform-config.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    ReactiveFormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzFormModule,
    NzGridModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzSelectModule,
    NzSpinModule,
    NzTagModule,
    AuthDirective
  ]
})
export class EnergyRentalPlatformConfigComponent implements OnInit {
  readonly ActionCode = ActionCode;
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly activeCatFeeEnvironment = signal('nile');
  readonly config = signal<EnergyPlatformConfig | null>(null);
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '平台配置',
    breadcrumb: ['首页', '机器人控制', '平台配置'],
    desc: '配置 TRON API、Bitcart 收款、服务商参数和任务参数'
  };
  readonly catFeeEnvironmentOptions = [
    { label: 'Nile 测试环境', value: 'nile', icon: 'experiment', desc: '用于下单联调，账号和 Key 与生产环境不互通。' },
    { label: '生产环境', value: 'prod', icon: 'cloud-server', desc: '正式上线后使用，确认测试通过后再切换。' }
  ];
  readonly yesNoOptions = [
    { label: '启用', value: true },
    { label: '停用', value: false }
  ];

  readonly form = inject(FormBuilder).nonNullable.group({
    tronApiBaseUrl: ['https://api.trongrid.io', [Validators.required]],
    tronApiKey: [''],
    platformReceiveAddress: ['', [Validators.required, Validators.pattern(/^T[A-Za-z0-9]{33}$/)]],
    bitcartApiBaseUrl: ['', [Validators.required]],
    bitcartAdminBaseUrl: ['', [Validators.required]],
    bitcartApiToken: [''],
    bitcartStoreId: ['', [Validators.required]],
    bitcartCurrency: ['TRX', [Validators.required]],
    bitcartWebhookBaseUrl: ['', [Validators.required]],
    bitcartWebhookSecret: [''],
    catfeeEnvironment: ['nile', [Validators.required]],
    catfeeProdApiBaseUrl: ['https://api.catfee.io', [Validators.required]],
    catfeeProdApiKey: [''],
    catfeeProdApiSecret: [''],
    catfeeNileApiBaseUrl: ['https://nile.catfee.io', [Validators.required]],
    catfeeNileApiKey: [''],
    catfeeNileApiSecret: [''],
    catfeeAutoActivate: [true, [Validators.required]],
    orderPaymentTtlMinutes: [10, [Validators.required]],
    telegramPollingIntervalSeconds: [2, [Validators.required]],
    workerIntervalSeconds: [60, [Validators.required]],
    minTrxReserveSun: ['0']
  });

  private dataService = inject(EnergyRentalService);
  private destroyRef = inject(DestroyRef);

  statusText(value: boolean | undefined): string {
    return value ? '已配置' : '未配置';
  }

  statusColor(value: boolean | undefined): string {
    return value ? 'green' : 'red';
  }

  selectCatFeeEnvironment(environment: string): void {
    const nextEnvironment = environment === 'prod' ? 'prod' : 'nile';
    this.form.controls.catfeeEnvironment.setValue(nextEnvironment);
    this.activeCatFeeEnvironment.set(nextEnvironment);
  }

  loadConfig(): void {
    this.loading.set(true);
    this.dataService
      .getPlatformConfig()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => {
        this.config.set(data);
        this.form.patchValue({
          tronApiBaseUrl: data.tronApiBaseUrl,
          tronApiKey: '',
          platformReceiveAddress: data.platformReceiveAddress ?? '',
          bitcartApiBaseUrl: data.bitcartApiBaseUrl ?? '',
          bitcartAdminBaseUrl: data.bitcartAdminBaseUrl ?? '',
          bitcartApiToken: '',
          bitcartStoreId: data.bitcartStoreId ?? '',
          bitcartCurrency: data.bitcartCurrency ?? 'TRX',
          bitcartWebhookBaseUrl: data.bitcartWebhookBaseUrl ?? '',
          bitcartWebhookSecret: '',
          catfeeEnvironment: data.catfeeEnvironment ?? 'nile',
          catfeeProdApiBaseUrl: data.catfeeProdApiBaseUrl ?? 'https://api.catfee.io',
          catfeeProdApiKey: '',
          catfeeProdApiSecret: '',
          catfeeNileApiBaseUrl: data.catfeeNileApiBaseUrl ?? 'https://nile.catfee.io',
          catfeeNileApiKey: '',
          catfeeNileApiSecret: '',
          catfeeAutoActivate: data.catfeeAutoActivate ?? true,
          orderPaymentTtlMinutes: data.orderPaymentTtlMinutes,
          telegramPollingIntervalSeconds: data.telegramPollingIntervalSeconds,
          workerIntervalSeconds: data.workerIntervalSeconds,
          minTrxReserveSun: String(data.minTrxReserveSun ?? '0')
        });
        this.activeCatFeeEnvironment.set(data.catfeeEnvironment === 'prod' ? 'prod' : 'nile');
      });
  }

  submit(): void {
    if (!fnCheckForm(this.form)) {
      return;
    }
    this.saving.set(true);
    this.dataService
      .updatePlatformConfig(this.form.getRawValue())
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.loadConfig();
      });
  }

  ngOnInit(): void {
    this.form.controls.catfeeEnvironment.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(environment => {
      this.activeCatFeeEnvironment.set(environment === 'prod' ? 'prod' : 'nile');
    });
    this.loadConfig();
  }
}
