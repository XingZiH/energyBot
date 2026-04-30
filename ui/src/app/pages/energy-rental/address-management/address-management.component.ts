import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import { SearchCommonVO } from '@core/services/types';
import { EnergyRentalService, EnergyUserAddressStats } from '@services/energy-rental/energy-rental.service';
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

interface AddressSearchParam {
  telegramChatId: string;
  label: string;
  address: string;
  status: string;
}

@Component({
  selector: 'app-energy-rental-address-management',
  templateUrl: './address-management.component.html',
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
export class EnergyRentalAddressManagementComponent implements OnInit {
  readonly defaultTpl = viewChild.required<TemplateRef<NzSafeAny>>('defaultTpl');
  readonly statusTpl = viewChild.required<TemplateRef<NzSafeAny>>('statusTpl');
  readonly trxTpl = viewChild.required<TemplateRef<NzSafeAny>>('trxTpl');
  searchParam: Partial<AddressSearchParam> = {};
  readonly dataList = signal<EnergyUserAddressStats[]>([]);
  readonly tableConfig = signal<AntTableConfig>({ headers: [], total: 0, showCheckbox: false, loading: false, pageSize: 10, pageIndex: 1 });
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '地址管理',
    breadcrumb: ['首页', '机器人控制', '地址管理'],
    desc: '统计机器人用户绑定的 TRON 接收地址、订单数量、收入和最近下单时间。'
  };
  readonly statusOptions = [
    { label: '启用', value: 'active' },
    { label: '已删除', value: 'deleted' }
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
    const params: SearchCommonVO<Partial<EnergyUserAddressStats>> = {
      pageSize: this.tableConfig().pageSize,
      pageIndex: e?.pageIndex || this.tableConfig().pageIndex,
      filters: this.searchParam
    };
    this.dataService
      .getAddresses(params)
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
    const colorMap: Record<string, string> = { active: 'success', deleted: 'default' };
    return status ? colorMap[status] || 'default' : 'default';
  }

  statusText(status?: string): string {
    const textMap: Record<string, string> = { active: '启用', deleted: '已删除' };
    return status ? textMap[status] || status : '-';
  }

  sunToTrx(value?: string | number): string {
    return `${(Number(value || 0) / 1_000_000).toFixed(4)} TRX`;
  }

  ngOnInit(): void {
    this.tableConfig.set({
      headers: [
        { title: 'Telegram ID', field: 'telegramChatId', width: 150 },
        { title: '备注', field: 'label', width: 120 },
        { title: '接收地址', field: 'address', width: 260 },
        { title: '默认', field: 'isDefault', tdTemplate: this.defaultTpl(), width: 90 },
        { title: '状态', field: 'status', tdTemplate: this.statusTpl(), width: 90 },
        { title: '订单数', field: 'orderCount', width: 90 },
        { title: '待支付', field: 'pendingOrderCount', width: 90 },
        { title: '租赁中', field: 'rentingOrderCount', width: 90 },
        { title: '已完成', field: 'completedOrderCount', width: 90 },
        { title: '失败', field: 'failedOrderCount', width: 80 },
        { title: '结算能量', field: 'totalEnergyAmount', width: 120 },
        { title: '结算收入', field: 'totalPaymentSun', tdTemplate: this.trxTpl(), width: 120 },
        { title: '最近下单', field: 'lastOrderAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
        { title: '绑定时间', field: 'createdAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 }
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
