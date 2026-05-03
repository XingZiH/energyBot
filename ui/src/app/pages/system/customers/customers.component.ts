import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  TemplateRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';

import { ActionCode } from '@app/config/actionCode';
import { SearchCommonVO } from '@core/services/types';
import {
  Customer,
  CustomerService,
  LicenseCredential,
  ListCustomerFilter,
} from '@services/system/customer.service';
import { AntTableConfig, AntTableComponent } from '@shared/components/ant-table/ant-table.component';
import { CardTableWrapComponent } from '@shared/components/card-table-wrap/card-table-wrap.component';
import { PageHeaderType, PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { LicenseCredentialDrawerComponent } from '@shared/biz-components/license-credential-drawer/license-credential-drawer.component';
import { AuthDirective } from '@shared/directives/auth.directive';
import { ModalBtnStatus } from '@widget/base-modal';
import { CustomerModalService } from '@widget/biz-widget/system/customer-modal/customer-modal.service';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzSafeAny } from 'ng-zorro-antd/core/types';
import { NzWaveModule } from 'ng-zorro-antd/core/wave';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTagModule } from 'ng-zorro-antd/tag';

interface SearchParam {
  name?: string;
  status?: 'active' | 'suspended' | 'all';
}

/**
 * 客户与 License 管理列表页。
 *
 * 设计：
 * - 列表展示客户基础字段 + license 状态徽章（已颁发 / 已吊销）
 * - 新建：弹出 CustomerModal → 成功后弹凭据抽屉（不可关闭直到勾选）
 * - 编辑：只修改客户资料（名称/联系/备注/状态），不触发 license 操作
 * - 重新颁发：confirm 提示吊销旧 → 成功后弹凭据抽屉
 * - 吊销：confirm 提示不可恢复 → 成功后刷新列表
 * - 查看安装命令：reveal 权限才可用，调用 getInstallCommand 后弹凭据抽屉
 *   （此时 credential.licenseSecret 为空，因为只有 installCommand 回显）
 */
@Component({
  selector: 'app-customers',
  templateUrl: './customers.component.html',
  styleUrl: './customers.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    NzGridModule,
    NzCardModule,
    FormsModule,
    NzFormModule,
    NzInputModule,
    NzSelectModule,
    NzButtonModule,
    NzWaveModule,
    NzIconModule,
    NzTagModule,
    CardTableWrapComponent,
    AntTableComponent,
    AuthDirective,
    LicenseCredentialDrawerComponent,
  ],
})
export class CustomersComponent implements OnInit {
  readonly operationTpl = viewChild.required<TemplateRef<NzSafeAny>>('operationTpl');
  readonly licenseStatusTpl = viewChild.required<TemplateRef<NzSafeAny>>('licenseStatusTpl');
  readonly statusTpl = viewChild.required<TemplateRef<NzSafeAny>>('statusTpl');

  searchParam: SearchParam = { status: 'all' };
  tableConfig = signal<AntTableConfig>({
    headers: [],
    total: 0,
    showCheckbox: false,
    loading: false,
    pageSize: 10,
    pageIndex: 1,
  });
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '客户与 License 管理',
    breadcrumb: ['首页', '系统管理', '客户与 License 管理'],
    desc: '统一管理 agent 客户，支持颁发 / 吊销 / 重发 license 并生成一键部署命令。',
  };
  dataList = signal<Customer[]>([]);
  ActionCode = ActionCode;

  /** 凭据抽屉状态 */
  drawerVisible = signal(false);
  currentCredential: LicenseCredential | null = null;
  drawerTitle = 'License 凭据';
  drawerShowSecret = true;

  readonly statusOptions = [
    { label: '全部', value: 'all' },
    { label: '正常', value: 'active' },
    { label: '暂停', value: 'suspended' },
  ];

  destroyRef = inject(DestroyRef);
  private dataService = inject(CustomerService);
  private modalSrv = inject(NzModalService);
  private modalService = inject(CustomerModalService);
  private message = inject(NzMessageService);

  resetForm(): void {
    this.searchParam = { status: 'all' };
    this.getDataList({ pageIndex: 1 });
  }

  getDataList(e?: { pageIndex: number }): void {
    this.tableLoading(true);
    const filters: ListCustomerFilter = {};
    if (this.searchParam.name) filters.name = this.searchParam.name;
    if (this.searchParam.status) filters.status = this.searchParam.status;
    const params: SearchCommonVO<ListCustomerFilter> = {
      pageSize: this.tableConfig().pageSize!,
      pageIndex: e?.pageIndex || this.tableConfig().pageIndex!,
      filters,
    };
    this.dataService
      .listCustomers(params)
      .pipe(
        finalize(() => this.tableLoading(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(data => {
        const { list, total, pageIndex } = data;
        this.dataList.set([...list]);
        this.tableConfig.update(c => ({ ...c, total: total!, pageIndex: pageIndex! }));
      });
  }

  tableLoading(isLoading: boolean): void {
    this.tableConfig.update(config => ({ ...config, loading: isLoading }));
  }

  reloadTable(): void {
    this.message.info('刷新成功');
    this.getDataList();
  }

  add(): void {
    this.modalService
      .show({ nzTitle: '新增客户' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => {
        if (!res || res.status === ModalBtnStatus.Cancel) return;
        this.tableLoading(true);
        this.dataService
          .createCustomer(res.modalValue)
          .pipe(
            finalize(() => this.tableLoading(false)),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe(credential => {
            this.openCredentialDrawer(credential, '新客户 License 凭据');
            this.getDataList();
          });
      });
  }

  edit(customer: Customer): void {
    this.modalService
      .show({ nzTitle: '编辑客户' }, customer)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => {
        if (!res || res.status === ModalBtnStatus.Cancel) return;
        this.tableLoading(true);
        this.dataService
          .updateCustomer({ id: customer.id, ...res.modalValue })
          .pipe(
            finalize(() => this.tableLoading(false)),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe(() => this.getDataList());
      });
  }

  revoke(customer: Customer): void {
    this.modalSrv.confirm({
      nzTitle: `确认吊销 ${customer.name} 的 license？`,
      nzContent: '吊销后 agent 无法再通过 precheck 校验；该操作不可撤销（需重新颁发）。',
      nzOkDanger: true,
      nzOkText: '吊销',
      nzOnOk: () => {
        this.tableLoading(true);
        this.dataService
          .revokeLicense(customer.id)
          .pipe(
            finalize(() => this.tableLoading(false)),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe(result => {
            if (result.revokedCount === 0) {
              this.message.info('该客户当前没有生效的 license');
            }
            this.getDataList();
          });
      },
    });
  }

  reissue(customer: Customer): void {
    this.modalSrv.confirm({
      nzTitle: `确认为 ${customer.name} 重新颁发 license？`,
      nzContent:
        '旧 license 将立刻失效，agent 必须使用新凭据重新部署。请确认客户已知晓。',
      nzOkText: '重新颁发',
      nzOnOk: () => {
        this.tableLoading(true);
        this.dataService
          .reissueLicense(customer.id)
          .pipe(
            finalize(() => this.tableLoading(false)),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe(credential => {
            credential.customerId = customer.id;
            this.openCredentialDrawer(credential, `${customer.name} - 新 License 凭据`);
            this.getDataList();
          });
      },
    });
  }

  viewInstallCommand(customer: Customer): void {
    this.dataService
      .getInstallCommand(customer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => {
        // reveal 场景只回显 installCommand（内已含 secret），不单独暴露 licenseSecret 字段
        this.openCredentialDrawer(
          {
            customerId: customer.id,
            licenseKey: customer.activeLicenseKey ?? '',
            licenseSecret: '',
            installCommand: res.installCommand,
          },
          `${customer.name} - 安装命令`,
          false,
        );
      });
  }

  private openCredentialDrawer(
    credential: LicenseCredential,
    title: string,
    showSecret = true,
  ): void {
    this.currentCredential = credential;
    this.drawerTitle = title;
    this.drawerShowSecret = showSecret;
    this.drawerVisible.set(true);
  }

  onDrawerVisibleChange(visible: boolean): void {
    this.drawerVisible.set(visible);
    if (!visible) {
      this.currentCredential = null;
    }
  }

  changePageSize(e: number): void {
    this.tableConfig.update(config => ({ ...config, pageSize: e }));
  }

  ngOnInit(): void {
    this.initTable();
  }

  private initTable(): void {
    this.tableConfig.set({
      showCheckbox: false,
      headers: [
        { title: '客户名称', field: 'name', width: 140 },
        { title: '联系方式', field: 'contact', width: 160 },
        {
          title: '账户状态',
          field: 'status',
          width: 90,
          tdTemplate: this.statusTpl(),
        },
        {
          title: 'License',
          field: 'hasActiveLicense',
          width: 150,
          tdTemplate: this.licenseStatusTpl(),
        },
        {
          title: '最近心跳',
          field: 'lastSeenAt',
          width: 130,
          pipe: 'date:yyyy-MM-dd HH:mm',
        },
        {
          title: '创建时间',
          field: 'createdAt',
          width: 130,
          pipe: 'date:yyyy-MM-dd HH:mm',
        },
        {
          title: '操作',
          tdTemplate: this.operationTpl(),
          width: 220,
          fixed: true,
        },
      ],
      total: 0,
      loading: true,
      pageSize: 10,
      pageIndex: 1,
    });
    this.getDataList();
  }
}
