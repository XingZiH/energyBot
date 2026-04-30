import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import { SearchCommonVO } from '@core/services/types';
import { EnergyRentalOrder, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { AntTableComponent, AntTableConfig } from '@shared/components/ant-table/ant-table.component';
import { CardTableWrapComponent } from '@shared/components/card-table-wrap/card-table-wrap.component';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzSafeAny } from 'ng-zorro-antd/core/types';
import { NzWaveModule } from 'ng-zorro-antd/core/wave';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTagModule } from 'ng-zorro-antd/tag';

interface OrderSearchParam {
  orderNo: string;
  status: string;
  receiverAddress: string;
}

@Component({
  selector: 'app-energy-rental-orders',
  templateUrl: './orders.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    NzCardModule,
    FormsModule,
    NzFormModule,
    NzGridModule,
    NzInputModule,
    NzSelectModule,
    NzButtonModule,
    NzWaveModule,
    NzIconModule,
    NzTagModule,
    CardTableWrapComponent,
    AntTableComponent
  ]
})
export class EnergyRentalOrdersComponent implements OnInit {
  readonly statusTpl = viewChild.required<TemplateRef<NzSafeAny>>('statusTpl');
  readonly returnStatusTpl = viewChild.required<TemplateRef<NzSafeAny>>('returnStatusTpl');
  readonly trxTpl = viewChild.required<TemplateRef<NzSafeAny>>('trxTpl');
  readonly providerTpl = viewChild.required<TemplateRef<NzSafeAny>>('providerTpl');
  readonly providerEnvTpl = viewChild.required<TemplateRef<NzSafeAny>>('providerEnvTpl');
  readonly providerCostTpl = viewChild.required<TemplateRef<NzSafeAny>>('providerCostTpl');
  readonly externalStatusTpl = viewChild.required<TemplateRef<NzSafeAny>>('externalStatusTpl');
  readonly externalConfirmStatusTpl = viewChild.required<TemplateRef<NzSafeAny>>('externalConfirmStatusTpl');
  searchParam: Partial<OrderSearchParam> = {};
  readonly dataList = signal<EnergyRentalOrder[]>([]);
  readonly tableConfig = signal<AntTableConfig>({ headers: [], total: 0, showCheckbox: false, loading: false, pageSize: 10, pageIndex: 1 });
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '订单管理',
    breadcrumb: ['首页', '机器人控制', '订单管理'],
    desc: '查看支付、能量下发、服务商回收等订单状态。'
  };
  readonly statusOptions = [
    { label: '待支付', value: 'pending' },
    { label: '已支付', value: 'paid' },
    { label: '租赁中', value: 'renting' },
    { label: '已完成', value: 'completed' },
    { label: '失败', value: 'failed' },
    { label: '已取消', value: 'cancelled' }
  ];

  private dataService = inject(EnergyRentalService);
  private message = inject(NzMessageService);
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
    this.tableLoading(true);
    const params: SearchCommonVO<Partial<EnergyRentalOrder>> = {
      pageSize: this.tableConfig().pageSize,
      pageIndex: e?.pageIndex || this.tableConfig().pageIndex,
      filters: this.searchParam
    };
    this.dataService
      .getOrders(params)
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

  statusColor(status?: string): string {
    const colorMap: Record<string, string> = {
      pending: 'warning',
      paid: 'processing',
      renting: 'processing',
      completed: 'success',
      failed: 'error',
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

  returnStatusColor(status?: string): string {
    const colorMap: Record<string, string> = {
      none: 'default',
      pending: 'warning',
      provider_managed: 'processing',
      running: 'processing',
      completed: 'success',
      failed: 'error'
    };
    return status ? colorMap[status] || 'default' : 'default';
  }

  returnStatusText(status?: string): string {
    const textMap: Record<string, string> = {
      none: '未开始',
      pending: '待归还',
      provider_managed: '服务商自动回收',
      running: '归还中',
      completed: '已归还',
      failed: '归还失败'
    };
    return status ? textMap[status] || status : '-';
  }

  providerColor(provider?: string): string {
    return provider === 'catfee' ? 'blue' : 'green';
  }

  providerText(provider?: string): string {
    const textMap: Record<string, string> = {
      catfee: 'CatFee',
      justlend: 'JustLend'
    };
    return provider ? textMap[provider] || provider : '-';
  }

  providerEnvironmentText(environment?: string): string {
    const value = String(environment || '').toLowerCase();
    if (value === 'prod') {
      return '生产';
    }
    if (value === 'nile') {
      return 'Nile';
    }
    return '-';
  }

  externalStatusText(status?: string): string {
    return status || '-';
  }

  sunToTrx(value?: string | number): string {
    return `${(Number(value || 0) / 1_000_000).toFixed(4)} TRX`;
  }

  ngOnInit(): void {
    this.tableConfig.set({
      headers: [
        { title: '订单号', field: 'orderNo', width: 180 },
        { title: '套餐', field: 'packageName', width: 150 },
        { title: '付款地址', field: 'buyerAddress', width: 220 },
        { title: '接收地址', field: 'receiverAddress', width: 220 },
        { title: '服务商', field: 'energyProvider', tdTemplate: this.providerTpl(), width: 100 },
        { title: '环境', field: 'externalProviderEnvironment', tdTemplate: this.providerEnvTpl(), width: 90 },
        { title: '服务商订单', field: 'externalOrderId', width: 190 },
        { title: '服务商状态', field: 'externalStatus', tdTemplate: this.externalStatusTpl(), width: 150 },
        { title: '链上确认', field: 'externalConfirmStatus', tdTemplate: this.externalConfirmStatusTpl(), width: 160 },
        { title: '能量数量', field: 'energyAmount', width: 100 },
        { title: '支付金额', field: 'paymentAmountSun', tdTemplate: this.trxTpl(), width: 120 },
        { title: '服务商成本', field: 'providerCostSun', tdTemplate: this.providerCostTpl(), width: 120 },
        { title: '订单状态', field: 'status', tdTemplate: this.statusTpl(), width: 110 },
        { title: '回收状态', field: 'returnStatus', tdTemplate: this.returnStatusTpl(), width: 140 },
        { title: '支付截止', field: 'paymentExpiresAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
        { title: '租赁到期', field: 'expiresAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
        { title: '创建时间', field: 'createdAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 }
      ],
      total: 0,
      showCheckbox: false,
      loading: false,
      pageSize: 10,
      pageIndex: 1
    });
    this.getDataList();
  }
}
