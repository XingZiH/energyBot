import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import { SearchCommonVO } from '@core/services/types';
import { EnergyRentalService, WalletTransaction } from '@services/energy-rental/energy-rental.service';
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

interface WalletTransactionSearchParam {
  txHash: string;
  walletAddress: string;
  direction: string;
  transactionType: string;
  status: string;
}

@Component({
  selector: 'app-energy-rental-wallet-transactions',
  templateUrl: './wallet-transactions.component.html',
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
export class EnergyRentalWalletTransactionsComponent implements OnInit {
  readonly statusTpl = viewChild.required<TemplateRef<NzSafeAny>>('statusTpl');
  readonly directionTpl = viewChild.required<TemplateRef<NzSafeAny>>('directionTpl');
  readonly typeTpl = viewChild.required<TemplateRef<NzSafeAny>>('typeTpl');
  readonly trxTpl = viewChild.required<TemplateRef<NzSafeAny>>('trxTpl');
  searchParam: Partial<WalletTransactionSearchParam> = {};
  readonly dataList = signal<WalletTransaction[]>([]);
  readonly tableConfig = signal<AntTableConfig>({ headers: [], total: 0, showCheckbox: false, loading: false, pageSize: 10, pageIndex: 1 });
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '钱包流水',
    breadcrumb: ['首页', '机器人控制', '钱包流水'],
    desc: '查看用户付款、平台支出和订单匹配流水。'
  };
  readonly directionOptions = [
    { label: '收入', value: 'in' },
    { label: '支出', value: 'out' }
  ];
  readonly statusOptions = [
    { label: '待确认', value: 'pending' },
    { label: '成功', value: 'success' },
    { label: '失败', value: 'failed' }
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
    const params: SearchCommonVO<Partial<WalletTransaction>> = {
      pageSize: this.tableConfig().pageSize,
      pageIndex: e?.pageIndex || this.tableConfig().pageIndex,
      filters: this.searchParam
    };
    this.dataService
      .getWalletTransactions(params)
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
    const colorMap: Record<string, string> = { pending: 'processing', success: 'success', failed: 'error' };
    return status ? colorMap[status] || 'default' : 'default';
  }

  directionColor(direction?: string): string {
    return direction === 'out' ? 'orange' : 'green';
  }

  statusText(status?: string): string {
    const textMap: Record<string, string> = {
      pending: '待确认',
      success: '成功',
      failed: '失败'
    };
    return status ? textMap[status] || status : '-';
  }

  directionText(direction?: string): string {
    const textMap: Record<string, string> = {
      in: '收入',
      out: '支出'
    };
    return direction ? textMap[direction] || direction : '-';
  }

  transactionTypeText(transactionType?: string): string {
    const textMap: Record<string, string> = {
      payment: '用户付款',
      rent: '租赁支出',
      return: '归还释放',
      refund: '退款',
      deposit: '押金',
      fee: '链上手续费'
    };
    return transactionType ? textMap[transactionType] || transactionType : '-';
  }

  sunToTrx(value?: string | number): string {
    return `${(Number(value || 0) / 1_000_000).toFixed(4)} TRX`;
  }

  ngOnInit(): void {
    this.tableConfig.set({
      headers: [
        { title: '交易哈希', field: 'txHash', width: 220 },
        { title: '钱包地址', field: 'walletAddress', width: 220 },
        { title: '金额', field: 'amountSun', tdTemplate: this.trxTpl(), width: 120 },
        { title: '收支方向', field: 'direction', tdTemplate: this.directionTpl(), width: 100 },
        { title: '类型', field: 'transactionType', tdTemplate: this.typeTpl(), width: 140 },
        { title: '状态', field: 'status', tdTemplate: this.statusTpl(), width: 100 },
        { title: '关联订单', field: 'relatedOrderId', width: 100 },
        { title: '确认时间', field: 'confirmedAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
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
