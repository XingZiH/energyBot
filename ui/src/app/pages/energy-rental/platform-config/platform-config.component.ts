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
  readonly activeProvider = signal('justlend');
  readonly activeCatFeeEnvironment = signal('nile');
  readonly config = signal<EnergyPlatformConfig | null>(null);
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '平台配置',
    breadcrumb: ['首页', '机器人控制', '平台配置'],
    desc: '配置 TRON API、Bitcart 收款、服务商参数和任务参数'
  };
  readonly providerOptions = [
    { label: 'JustLend 合约', value: 'justlend', icon: 'deployment-unit', desc: '使用 JustLend 官方合约，平台付款私钥负责押金、租赁和归还。' },
    { label: 'CatFee API', value: 'catfee', icon: 'api', desc: '通过 CatFee 下发能量，支持 Nile 沙盒和生产环境独立配置。' }
  ];
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
    bitcartApiBaseUrl: ['', [Validators.required]],
    bitcartAdminBaseUrl: ['', [Validators.required]],
    bitcartApiToken: [''],
    bitcartStoreId: ['', [Validators.required]],
    bitcartCurrency: ['TRX', [Validators.required]],
    bitcartWebhookBaseUrl: ['', [Validators.required]],
    bitcartWebhookSecret: [''],
    justlendContractAddress: ['', [Validators.required]],
    justlendPayerPrivateKey: [''],
    catfeePayerPrivateKey: [''],
    energyProvider: ['justlend', [Validators.required]],
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

  selectProvider(provider: string): void {
    const nextProvider = provider === 'catfee' ? 'catfee' : 'justlend';
    this.form.controls.energyProvider.setValue(nextProvider);
    this.activeProvider.set(nextProvider);
    this.syncProviderValidators(nextProvider);
  }

  selectCatFeeEnvironment(environment: string): void {
    const nextEnvironment = environment === 'prod' ? 'prod' : 'nile';
    this.form.controls.catfeeEnvironment.setValue(nextEnvironment);
    this.activeCatFeeEnvironment.set(nextEnvironment);
  }

  private syncProviderValidators(provider: string): void {
    const justlendContractAddress = this.form.controls.justlendContractAddress;
    if (provider === 'justlend') {
      justlendContractAddress.addValidators(Validators.required);
    } else {
      justlendContractAddress.removeValidators(Validators.required);
    }
    justlendContractAddress.updateValueAndValidity({ emitEvent: false });
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
          bitcartApiBaseUrl: data.bitcartApiBaseUrl ?? '',
          bitcartAdminBaseUrl: data.bitcartAdminBaseUrl ?? '',
          bitcartApiToken: '',
          bitcartStoreId: data.bitcartStoreId ?? '',
          bitcartCurrency: data.bitcartCurrency ?? 'TRX',
          bitcartWebhookBaseUrl: data.bitcartWebhookBaseUrl ?? '',
          bitcartWebhookSecret: '',
          justlendContractAddress: data.justlendContractAddress,
          justlendPayerPrivateKey: '',
          catfeePayerPrivateKey: '',
          energyProvider: data.energyProvider ?? 'justlend',
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
        this.activeProvider.set(data.energyProvider === 'catfee' ? 'catfee' : 'justlend');
        this.activeCatFeeEnvironment.set(data.catfeeEnvironment === 'prod' ? 'prod' : 'nile');
        this.syncProviderValidators(this.activeProvider());
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
    this.syncProviderValidators(this.form.controls.energyProvider.value);
    this.form.controls.energyProvider.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(provider => {
      this.activeProvider.set(provider === 'catfee' ? 'catfee' : 'justlend');
      this.syncProviderValidators(provider);
    });
    this.form.controls.catfeeEnvironment.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(environment => {
      this.activeCatFeeEnvironment.set(environment === 'prod' ? 'prod' : 'nile');
    });
    this.loadConfig();
  }
}
