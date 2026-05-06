import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, TemplateRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import { SearchCommonVO } from '@core/services/types';
import { EnergyRentalService, ReturnTask } from '@services/energy-rental/energy-rental.service';
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

interface ReturnTaskSearchParam {
  orderId: number;
  receiverAddress: string;
  status: string;
}

@Component({
  selector: 'app-energy-rental-return-tasks',
  templateUrl: './return-tasks.component.html',
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
export class EnergyRentalReturnTasksComponent implements OnInit {
  readonly statusTpl = viewChild.required<TemplateRef<NzSafeAny>>('statusTpl');
  readonly operationTpl = viewChild.required<TemplateRef<NzSafeAny>>('operationTpl');
  searchParam: Partial<ReturnTaskSearchParam> = {};
  readonly dataList = signal<ReturnTask[]>([]);
  readonly tableConfig = signal<AntTableConfig>({ headers: [], total: 0, showCheckbox: false, loading: false, pageSize: 10, pageIndex: 1 });
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '归还任务',
    breadcrumb: ['首页', '机器人控制', '归还任务'],
    desc: 'CatFee 订单由服务商自动回收；归还任务仅保留历史遗留数据，不会新增。'
  };
  readonly statusOptions = [
    { label: '待处理', value: 'pending' },
    { label: '执行中', value: 'running' },
    { label: '已完成', value: 'completed' },
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
    const params: SearchCommonVO<Partial<ReturnTask>> = {
      pageSize: this.tableConfig().pageSize,
      pageIndex: e?.pageIndex || this.tableConfig().pageIndex,
      filters: this.searchParam
    };
    this.dataService
      .getReturnTasks(params)
      .pipe(
        finalize(() => this.tableLoading(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(data => {
        this.dataList.set([...data.list]);
        this.tableConfig.update(config => ({ ...config, total: data.total, pageIndex: data.pageIndex }));
      });
  }

  retry(id: number): void {
    this.tableLoading(true);
    this.dataService
      .retryReturnTask(id)
      .pipe(
        finalize(() => this.tableLoading(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.getDataList());
  }

  changePageSize(e: number): void {
    this.tableConfig.update(config => ({ ...config, pageSize: e }));
  }

  tableLoading(isLoading: boolean): void {
    this.tableConfig.update(config => ({ ...config, loading: isLoading }));
  }

  canRetry(status?: string): boolean {
    return status === 'failed' || status === 'pending';
  }

  statusColor(status?: string): string {
    const colorMap: Record<string, string> = {
      pending: 'warning',
      running: 'processing',
      completed: 'success',
      failed: 'error'
    };
    return status ? colorMap[status] || 'default' : 'default';
  }

  statusText(status?: string): string {
    const textMap: Record<string, string> = {
      pending: '待处理',
      running: '执行中',
      completed: '已完成',
      failed: '失败'
    };
    return status ? textMap[status] || status : '-';
  }

  ngOnInit(): void {
    this.tableConfig.set({
      headers: [
        { title: '任务 ID', field: 'id', width: 90 },
        { title: '订单 ID', field: 'orderId', width: 100 },
        { title: '接收地址', field: 'receiverAddress', width: 220 },
        { title: '能量数量', field: 'energyAmount', width: 100 },
        { title: '状态', field: 'status', tdTemplate: this.statusTpl(), width: 100 },
        { title: '重试次数', field: 'attempts', width: 100 },
        { title: '下次重试时间', field: 'nextRetryAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
        { title: '完成时间', field: 'completedAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
        { title: '创建时间', field: 'createdAt', pipe: 'dateRaw:yyyy-MM-dd HH:mm', width: 160 },
        { title: '操作', tdTemplate: this.operationTpl(), width: 110, fixed: true, fixedDir: 'right' }
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
