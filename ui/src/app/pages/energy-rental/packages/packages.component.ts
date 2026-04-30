import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY } from 'rxjs';
import { catchError, debounceTime, finalize } from 'rxjs/operators';

import { ActionCode } from '@config/actionCode';
import { SearchCommonVO } from '@core/services/types';
import { EnergyPackageEstimate, EnergyRentalPackage, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { UserInfoStoreService } from '@store/common-store/userInfo-store.service';
import { AntTableComponent, AntTableConfig, TableHeader } from '@shared/components/ant-table/ant-table.component';
import { CardTableWrapComponent } from '@shared/components/card-table-wrap/card-table-wrap.component';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';
import { AuthDirective } from '@shared/directives/auth.directive';
import { fnCheckForm } from '@utils/tools';

import { buildProviderPriceRequest, normalizeEnergyProvider, providerLabel, providerMinEnergyAmount } from './provider-price-summary';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzSafeAny } from 'ng-zorro-antd/core/types';
import { NzWaveModule } from 'ng-zorro-antd/core/wave';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTagModule } from 'ng-zorro-antd/tag';

interface PackageSearchParam {
  packageName: string;
  status: string;
}

interface PackageFormValue {
  platformPackageId: number | null;
  packageName: string;
  energyAmount: number;
  durationHours: number;
  priceTrx: number;
  idlePriceTrx: number;
  busyPriceTrx: number;
  status: string;
  sortOrder: number;
  description: string;
}

interface PackageProfitRow {
  label: string;
  platformPrice: string;
  salePrice: string;
  profit: string;
  profitRate: string;
  negative: boolean;
}

type AdminPackageView = 'platform-prices' | 'packages';

@Component({
  selector: 'app-energy-rental-packages',
  templateUrl: './packages.component.html',
  styleUrl: './packages.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    NzCardModule,
    FormsModule,
    ReactiveFormsModule,
    NzFormModule,
    NzGridModule,
    NzInputModule,
    NzInputNumberModule,
    NzSelectModule,
    NzButtonModule,
    NzWaveModule,
    NzIconModule,
    NzTagModule,
    NzModalModule,
    CardTableWrapComponent,
    AntTableComponent,
    AuthDirective
  ]
})
export class EnergyRentalPackagesComponent implements OnInit {
  readonly ActionCode = ActionCode;
  readonly operationTpl = viewChild.required<TemplateRef<NzSafeAny>>('operationTpl');
  readonly statusTpl = viewChild.required<TemplateRef<NzSafeAny>>('statusTpl');
  readonly priceTpl = viewChild.required<TemplateRef<NzSafeAny>>('priceTpl');
  searchParam: Partial<PackageSearchParam> = {};
  packageForm!: FormGroup;
  readonly dataList = signal<EnergyRentalPackage[]>([]);
  readonly tableConfig = signal<AntTableConfig>({ headers: [], total: 0, showCheckbox: false, loading: false, pageSize: 10, pageIndex: 1 });
  readonly packageModalVisible = signal(false);
  readonly packageSaving = signal(false);
  readonly editingPackageId = signal<number | null>(null);
  readonly packageEstimate = signal<EnergyPackageEstimate | null>(null);
  readonly estimateLoading = signal(false);
  readonly estimateError = signal('');
  readonly providerPriceEstimate = signal<EnergyPackageEstimate | null>(null);
  readonly providerPriceLoading = signal(false);
  readonly providerPriceError = signal('');
  readonly activeEnergyProvider = signal('justlend');
  readonly packageScopeLoaded = signal(false);
  readonly isAgentScope = signal(false);
  readonly adminPackageView = signal<AdminPackageView>('platform-prices');
  readonly platformPackageOptions = signal<EnergyRentalPackage[]>([]);
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '套餐配置',
    breadcrumb: ['首页', '机器人控制', '套餐配置'],
    desc: '维护 1 小时能量套餐的价格与启用状态。'
  };
  readonly statusOptions = [
    { label: '启用', value: 'active' },
    { label: '停用', value: 'disabled' }
  ];

  private fb = inject(FormBuilder);
  private dataService = inject(EnergyRentalService);
  private message = inject(NzMessageService);
  private modalSrv = inject(NzModalService);
  private userInfoService = inject(UserInfoStoreService);
  private destroyRef = inject(DestroyRef);

  resetForm(): void {
    this.searchParam = {};
    this.getDataList({ pageIndex: 1 });
  }

  reloadTable(): void {
    this.message.info('已刷新');
    this.getDataList();
  }

  getDataList(e?: { pageIndex?: number }): void {
    if (!this.packageScopeLoaded()) {
      return;
    }
    this.tableLoading(true);
    const params: SearchCommonVO<Partial<EnergyRentalPackage>> = {
      pageSize: this.tableConfig().pageSize,
      pageIndex: e?.pageIndex || this.tableConfig().pageIndex,
      filters: this.searchParam
    };
    const request$ = this.isPlatformPriceMode() ? this.dataService.getPlatformPrices(params) : this.dataService.getPackages(params);
    request$
      .pipe(
        finalize(() => this.tableLoading(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => {
        this.dataList.set([...data.list]);
        this.tableConfig.update(config => ({ ...config, total: data.total, pageIndex: data.pageIndex }));
      });
  }

  changePageSize(e: number): void {
    this.tableConfig.update(config => ({ ...config, pageSize: e }));
  }

  tableLoading(isLoading: boolean): void {
    this.tableConfig.update(config => ({ ...config, loading: isLoading }));
  }

  addPackage(): void {
    if (this.isAgentScope() && this.platformPackageOptions().length === 0) {
      this.message.warning('管理员还没有启用平台价格，暂不能创建套餐');
      return;
    }
    const defaultPlatformPackage = this.isAgentScope() ? (this.platformPackageOptions()[0] ?? null) : null;
    const defaultIdlePriceSun = defaultPlatformPackage?.idlePriceSun ?? defaultPlatformPackage?.priceSun;
    const defaultBusyPriceSun = defaultPlatformPackage?.busyPriceSun ?? defaultPlatformPackage?.priceSun;
    this.editingPackageId.set(null);
    this.packageEstimate.set(null);
    this.estimateError.set('');
    this.packageForm.reset({
      platformPackageId: defaultPlatformPackage?.id ?? null,
      packageName: '',
      energyAmount: defaultPlatformPackage?.energyAmount ?? 130000,
      durationHours: defaultPlatformPackage?.durationHours ?? 1,
      priceTrx: 2,
      idlePriceTrx: defaultIdlePriceSun ? Number(defaultIdlePriceSun) / 1_000_000 : 1.755,
      busyPriceTrx: defaultBusyPriceSun ? Number(defaultBusyPriceSun) / 1_000_000 : 2.405,
      status: 'active',
      sortOrder: 0,
      description: ''
    });
    this.packageModalVisible.set(true);
    if (!this.isAgentScope()) {
      this.refreshEstimate();
    }
  }

  editPackage(id: number): void {
    this.tableLoading(true);
    const request$ = this.isPlatformPriceMode() ? this.dataService.getPlatformPriceDetail(id) : this.dataService.getPackageDetail(id);
    request$
      .pipe(
        finalize(() => this.tableLoading(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => {
        this.editingPackageId.set(id);
        this.packageForm.patchValue({
          platformPackageId: data.platformPackageId ?? null,
          packageName: data.packageName,
          energyAmount: data.energyAmount,
          durationHours: data.durationHours,
          priceTrx: Number(data.priceSun || 0) / 1_000_000,
          idlePriceTrx: Number(data.idlePriceSun ?? data.priceSun ?? 0) / 1_000_000,
          busyPriceTrx: Number(data.busyPriceSun ?? data.priceSun ?? 0) / 1_000_000,
          status: data.status,
          sortOrder: data.sortOrder ?? 0,
          description: data.description ?? ''
        });
        this.packageModalVisible.set(true);
        if (!this.isAgentScope()) {
          this.refreshEstimate();
        }
      });
  }

  removePackage(id: number): void {
    const targetName = this.isPlatformPriceMode() ? '平台价格' : '套餐';
    const request$ = this.isPlatformPriceMode() ? this.dataService.deletePlatformPrices([id]) : this.dataService.deletePackages([id]);
    this.modalSrv.confirm({
      nzTitle: `确定要删除这个${targetName}吗？`,
      nzContent: this.isPlatformPriceMode()
        ? '删除前必须先迁移或删除引用该价格的套餐，避免用户套餐失去定价来源。'
        : '删除后新订单不能再选择该套餐，已创建订单会保留当时的套餐快照。',
      nzOkDanger: true,
      nzOnOk: () => {
        this.tableLoading(true);
        request$
          .pipe(
            finalize(() => this.tableLoading(false)),
            takeUntilDestroyed(this.destroyRef)
          )
          .subscribe(() => {
            if (this.dataList().length === 1 && this.tableConfig().pageIndex !== 1) {
              this.tableConfig.update(config => ({ ...config, pageIndex: config.pageIndex - 1 }));
            }
            if (this.isPlatformPriceMode()) {
              this.loadPlatformPackageOptions();
            }
            this.getDataList();
          });
      }
    });
  }

  submitPackage(): void {
    if (!fnCheckForm(this.packageForm)) {
      return;
    }
    const modalValue = this.packageForm.getRawValue() as PackageFormValue;
    if (this.isAgentScope()) {
      const platformPackageId = Number(modalValue.platformPackageId || 0);
      if (!platformPackageId) {
        this.message.error('请选择平台价格');
        return;
      }
      this.savePackage({
        platformPackageId,
        packageName: modalValue.packageName,
        priceSun: Math.round(Number(modalValue.idlePriceTrx || modalValue.priceTrx) * 1_000_000).toString(),
        idlePriceSun: Math.round(Number(modalValue.idlePriceTrx || modalValue.priceTrx) * 1_000_000).toString(),
        busyPriceSun: Math.round(Number(modalValue.busyPriceTrx || modalValue.priceTrx) * 1_000_000).toString(),
        status: modalValue.status,
        sortOrder: Number(modalValue.sortOrder || 0),
        description: modalValue.description
      });
      return;
    }

    const minEnergyAmount = this.currentMinEnergyAmount();
    if (Number(modalValue.energyAmount) < minEnergyAmount) {
      this.message.error(`${this.currentProviderLabel()} 套餐能量不能低于 ${minEnergyAmount}`);
      return;
    }
    const payload: Partial<EnergyRentalPackage> = {
      packageName: modalValue.packageName,
      energyAmount: Number(modalValue.energyAmount),
      durationHours: Number(modalValue.durationHours),
      priceSun: Math.round(Number(modalValue.idlePriceTrx || modalValue.priceTrx) * 1_000_000).toString(),
      idlePriceSun: Math.round(Number(modalValue.idlePriceTrx || modalValue.priceTrx) * 1_000_000).toString(),
      busyPriceSun: Math.round(Number(modalValue.busyPriceTrx || modalValue.priceTrx) * 1_000_000).toString(),
      status: modalValue.status,
      sortOrder: Number(modalValue.sortOrder || 0),
      description: modalValue.description
    };
    if (this.isPlatformPriceMode()) {
      this.savePlatformPrice(payload);
    } else {
      this.savePackage(payload);
    }
  }

  savePackage(payload: Partial<EnergyRentalPackage>): void {
    const editingId = this.editingPackageId();
    const request$ = editingId ? this.dataService.updatePackage({ id: editingId, ...payload }) : this.dataService.createPackage(payload);

    this.packageSaving.set(true);
    request$
      .pipe(
        finalize(() => this.packageSaving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.packageModalVisible.set(false);
        this.getDataList({ pageIndex: editingId ? this.tableConfig().pageIndex : 1 });
      });
  }

  savePlatformPrice(payload: Partial<EnergyRentalPackage>): void {
    const editingId = this.editingPackageId();
    const request$ = editingId
      ? this.dataService.updatePlatformPrice({ id: editingId, ...payload })
      : this.dataService.createPlatformPrice(payload);

    this.packageSaving.set(true);
    request$
      .pipe(
        finalize(() => this.packageSaving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.packageModalVisible.set(false);
        this.loadPlatformPackageOptions();
        this.getDataList({ pageIndex: editingId ? this.tableConfig().pageIndex : 1 });
      });
  }

  closePackageModal(): void {
    this.packageModalVisible.set(false);
    this.packageEstimate.set(null);
    this.estimateError.set('');
  }

  sunToTrx(value?: string | number): string {
    return `${(Number(value || 0) / 1_000_000).toFixed(4)} TRX`;
  }

  trx(value?: number | string | null): string {
    return `${Number(value || 0).toFixed(6)} TRX`;
  }

  formatEnergyAmount(value?: number | string | null): string {
    return Number(value || 0).toLocaleString('zh-CN');
  }

  percent(value?: number | string | null): string {
    return `${Number(value || 0).toFixed(2)}%`;
  }

  currentMinEnergyAmount(): number {
    return providerMinEnergyAmount(this.activeEnergyProvider());
  }

  currentProviderLabel(): string {
    return providerLabel(this.activeEnergyProvider());
  }

  energyAmountErrorTip(): string {
    return `请输入能量数量，${this.currentProviderLabel()} 最低 ${this.currentMinEnergyAmount()}`;
  }

  providerPriceScopeText(): string {
    const request = buildProviderPriceRequest(this.activeEnergyProvider());
    return `${this.formatEnergyAmount(request.energyAmount)} 能量 / ${request.durationHours} 小时 / 一笔订单`;
  }

  providerPriceExtraLabel(estimate: EnergyPackageEstimate): string {
    return estimate.provider === 'catfee' ? '扣费环境' : '下单占用';
  }

  providerPriceExtraValue(estimate: EnergyPackageEstimate): string {
    if (estimate.provider === 'catfee') {
      return estimate.catfeeEnvironment === 'prod' ? '生产环境' : 'Nile 环境';
    }
    return this.trx(estimate.totalPrepayTrx);
  }

  isPlatformPriceMode(): boolean {
    return !this.isAgentScope() && this.adminPackageView() === 'platform-prices';
  }

  isPackageSelectionMode(): boolean {
    return this.isAgentScope();
  }

  switchAdminPackageView(view: AdminPackageView): void {
    if (this.isAgentScope() || this.adminPackageView() === view) {
      return;
    }
    this.adminPackageView.set(view);
    this.searchParam = {};
    this.packageEstimate.set(null);
    this.estimateError.set('');
    this.configureTableHeaders();
    this.getDataList({ pageIndex: 1 });
  }

  tableTitle(): string {
    return this.isPlatformPriceMode() ? '平台价格列表' : '套餐列表';
  }

  addButtonText(): string {
    return this.isPlatformPriceMode() ? '新增平台价格' : '新增套餐';
  }

  modalTitle(): string {
    const action = this.editingPackageId() ? '编辑' : '新增';
    return `${action}${this.isPlatformPriceMode() ? '平台价格' : '套餐'}`;
  }

  nameLabel(): string {
    return this.isPlatformPriceMode() ? '价格名称' : '套餐名称';
  }

  namePlaceholder(): string {
    return this.isPlatformPriceMode() ? '例如：65K 能量 / 1 小时平台价格' : '例如：65K 能量 / 1 小时';
  }

  priceLabelPrefix(): string {
    return this.isPlatformPriceMode() ? '平台价格' : '套餐售价';
  }

  packageProfitRows(): PackageProfitRow[] {
    const selected = this.selectedPlatformPackage();
    if (!selected || !this.packageForm) {
      return [];
    }
    const { idlePriceTrx, busyPriceTrx } = this.packageForm.getRawValue() as PackageFormValue;
    return [
      this.buildPackageProfitRow(
        '闲时',
        selected.idlePriceSun ?? selected.priceSun,
        Number(idlePriceTrx || 0)
      ),
      this.buildPackageProfitRow(
        '忙时',
        selected.busyPriceSun ?? selected.priceSun,
        Number(busyPriceTrx || 0)
      )
    ];
  }

  addActionCode(): string {
    return this.isPlatformPriceMode() ? ActionCode.EnergyRentalPlatformConfigEdit : ActionCode.EnergyRentalPackageAdd;
  }

  editActionCode(): string {
    return this.isPlatformPriceMode() ? ActionCode.EnergyRentalPlatformConfigEdit : ActionCode.EnergyRentalPackageEdit;
  }

  deleteActionCode(): string {
    return this.isPlatformPriceMode() ? ActionCode.EnergyRentalPlatformConfigEdit : ActionCode.EnergyRentalPackageDel;
  }

  refreshProviderPrice(): void {
    if (this.isAgentScope()) {
      return;
    }
    const request = buildProviderPriceRequest(this.activeEnergyProvider());
    this.providerPriceLoading.set(true);
    this.providerPriceError.set('');
    this.dataService
      .estimatePackage(request)
      .pipe(
        catchError(() => {
          this.providerPriceEstimate.set(null);
          this.providerPriceError.set('当前服务商实时价格获取失败，请检查服务商 API 配置或稍后刷新。');
          return EMPTY;
        }),
        finalize(() => this.providerPriceLoading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => this.providerPriceEstimate.set(data));
  }

  statusColor(status?: string): string {
    return status === 'disabled' ? 'default' : 'success';
  }

  statusText(status?: string): string {
    return status === 'disabled' ? '停用' : '启用';
  }

  ngOnInit(): void {
    this.initPackageForm();
    this.loadPackageContext();
    this.refreshCurrentUserAuthCodes();
    this.configureTableHeaders();
  }

  private initPackageForm(): void {
    this.packageForm = this.fb.group({
      platformPackageId: [null],
      packageName: ['', [Validators.required]],
      energyAmount: [130000, [Validators.required, Validators.min(this.currentMinEnergyAmount())]],
      durationHours: [1, [Validators.required, Validators.min(1)]],
      priceTrx: [2, [Validators.required, Validators.min(0.000001)]],
      idlePriceTrx: [1.755, [Validators.required, Validators.min(0.000001)]],
      busyPriceTrx: [2.405, [Validators.required, Validators.min(0.000001)]],
      status: ['active', [Validators.required]],
      sortOrder: [0],
      description: ['']
    });
    this.packageForm.valueChanges.pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.isAgentScope()) {
        this.refreshEstimate();
      }
    });
    this.packageForm.get('platformPackageId')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.isAgentScope() && !this.editingPackageId()) {
          this.applySelectedPlatformPackageDefaults();
        }
      });
  }

  private loadPackageContext(): void {
    this.dataService
      .getDashboard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(data => {
        const isAgent = data.scope === 'agent';
        this.isAgentScope.set(isAgent);
        this.packageScopeLoaded.set(true);
        this.applyEnergyAmountValidator();
        this.configureTableHeaders();
        if (isAgent) {
          this.loadPlatformPackageOptions();
        } else {
          this.loadPlatformPackageOptions();
          this.loadActiveEnergyProvider();
        }
        this.getDataList({ pageIndex: 1 });
      });
  }

  private configureTableHeaders(): void {
    const headers: TableHeader[] = this.isPlatformPriceMode()
      ? [
          { title: '价格名称', field: 'packageName', width: 180 },
          { title: '能量数量', field: 'energyAmount', width: 110 },
          { title: '租赁时长（小时）', field: 'durationHours', width: 130 },
          { title: '平台售价', field: 'priceSun', width: 130, tdTemplate: this.priceTpl() },
          { title: '状态', field: 'status', tdTemplate: this.statusTpl(), width: 100 },
          { title: '创建时间', field: 'createdAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
          { title: '更新时间', field: 'updatedAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
          { title: '操作', tdTemplate: this.operationTpl(), width: 130, fixed: true, fixedDir: 'right' }
        ]
      : [
          { title: '套餐名称', field: 'packageName', width: 180 },
          ...(this.isAgentScope()
            ? [{ title: '平台价格', field: 'platformPackageName', width: 180 }]
            : []),
          { title: '能量数量', field: 'energyAmount', width: 110 },
          { title: '租赁时长（小时）', field: 'durationHours', width: 130 },
          { title: '售价', field: 'priceSun', width: 120, tdTemplate: this.priceTpl() },
          { title: '状态', field: 'status', tdTemplate: this.statusTpl(), width: 100 },
          { title: '创建时间', field: 'createdAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
          { title: '更新时间', field: 'updatedAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
          { title: '操作', tdTemplate: this.operationTpl(), width: 130, fixed: true, fixedDir: 'right' }
        ];
    this.tableConfig.update(config => ({ ...config, headers }));
  }

  private loadPlatformPackageOptions(): void {
    this.dataService
      .getPlatformPackageOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(data => this.platformPackageOptions.set(data || []));
  }

  private loadActiveEnergyProvider(): void {
    this.dataService
      .getPlatformConfig()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(config => {
        this.activeEnergyProvider.set(normalizeEnergyProvider(config.energyProvider || 'catfee'));
        this.applyEnergyAmountValidator();
        this.refreshProviderPrice();
        this.refreshEstimate();
      });
  }

  private applyEnergyAmountValidator(): void {
    const energyControl = this.packageForm.get('energyAmount');
    const durationControl = this.packageForm.get('durationHours');
    if (!energyControl || !durationControl) {
      return;
    }
    if (this.isAgentScope()) {
      energyControl.clearValidators();
      durationControl.clearValidators();
      energyControl.updateValueAndValidity({ emitEvent: false });
      durationControl.updateValueAndValidity({ emitEvent: false });
      return;
    }
    energyControl.setValidators([Validators.required, Validators.min(this.currentMinEnergyAmount())]);
    energyControl.updateValueAndValidity({ emitEvent: false });
    durationControl.setValidators([Validators.required, Validators.min(1)]);
    durationControl.updateValueAndValidity({ emitEvent: false });
  }

  private refreshEstimate(): void {
    if (this.isAgentScope() || !this.packageModalVisible() || !this.packageForm) {
      return;
    }
    const { energyAmount, durationHours, idlePriceTrx } = this.packageForm.getRawValue() as PackageFormValue;
    const energyValue = Number(energyAmount);
    const durationValue = Number(durationHours || 1);
    const priceValue = Number(idlePriceTrx || 0);

    const minEnergyAmount = this.currentMinEnergyAmount();
    if (!Number.isFinite(energyValue) || energyValue < minEnergyAmount) {
      this.packageEstimate.set(null);
      this.estimateError.set(`${this.currentProviderLabel()} 限制：套餐能量不能低于 ${minEnergyAmount}`);
      return;
    }
    if (!Number.isFinite(durationValue) || durationValue <= 0) {
      this.packageEstimate.set(null);
      this.estimateError.set('租赁时长必须大于 0');
      return;
    }

    this.estimateLoading.set(true);
    this.estimateError.set('');
    this.dataService
      .estimatePackage({
        energyAmount: energyValue,
        durationHours: durationValue,
        priceTrx: Number.isFinite(priceValue) ? priceValue : 0
      })
      .pipe(
        catchError(() => {
          this.packageEstimate.set(null);
          this.estimateError.set('当前服务商实时参数获取失败，请稍后重试或检查网络。');
          return EMPTY;
        }),
        finalize(() => this.estimateLoading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => this.packageEstimate.set(data));
  }

  private applySelectedPlatformPackageDefaults(): void {
    const selected = this.selectedPlatformPackage();
    if (!selected) {
      return;
    }
    this.packageForm.patchValue(
      {
        energyAmount: selected.energyAmount,
        durationHours: selected.durationHours,
        priceTrx: Number(selected.priceSun || 0) / 1_000_000,
        idlePriceTrx: Number(selected.idlePriceSun ?? selected.priceSun ?? 0) / 1_000_000,
        busyPriceTrx: Number(selected.busyPriceSun ?? selected.priceSun ?? 0) / 1_000_000
      },
      { emitEvent: false }
    );
  }

  selectedPlatformPackage(): EnergyRentalPackage | null {
    const selectedId = Number(this.packageForm?.get('platformPackageId')?.value || 0);
    return this.platformPackageOptions().find(item => Number(item.id) === selectedId) ?? null;
  }

  platformPackageOptionLabel(item: EnergyRentalPackage): string {
    return `${item.packageName}｜${this.formatEnergyAmount(item.energyAmount)} 能量｜${item.durationHours} 小时｜闲 ${this.sunToTrx(item.idlePriceSun || item.priceSun)} / 忙 ${this.sunToTrx(item.busyPriceSun || item.priceSun)}`;
  }

  private buildPackageProfitRow(label: string, platformPriceSun: string | number | null | undefined, salePriceTrx: number): PackageProfitRow {
    const platformPriceTrx = Number(platformPriceSun || 0) / 1_000_000;
    const salePrice = Number.isFinite(salePriceTrx) ? salePriceTrx : 0;
    const profit = salePrice - platformPriceTrx;
    const profitRate = salePrice > 0 ? (profit / salePrice) * 100 : 0;
    return {
      label,
      platformPrice: this.trx(platformPriceTrx),
      salePrice: this.trx(salePrice),
      profit: this.trx(profit),
      profitRate: this.percent(profitRate),
      negative: profit < 0
    };
  }

  private refreshCurrentUserAuthCodes(): void {
    const userInfo = this.userInfoService.$userInfo();
    if (userInfo.userId <= 0) {
      return;
    }
    this.userInfoService
      .getUserAuthCodeByUserId(userInfo.userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(authCode => {
        this.userInfoService.$userInfo.set({ ...userInfo, authCode });
      });
  }
}
