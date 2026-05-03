import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';

import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import {
  Customer,
  CustomerService,
  LicenseCredential,
} from '@services/system/customer.service';
import { ModalBtnStatus, ModalResponse } from '@widget/base-modal';
import { CustomerModalService } from '@widget/biz-widget/system/customer-modal/customer-modal.service';

import { CustomersComponent } from './customers.component';

/**
 * Customers 列表页的行为测试。
 *
 * 策略：mock 所有外部依赖，断言组件对 service 方法的编排与 signal 状态变更。
 * 不触发模板渲染（只 TestBed.createComponent 不 detectChanges），避开 nz-table 依赖。
 */
describe('CustomersComponent', () => {
  let dataServiceSpy: jasmine.SpyObj<CustomerService>;
  let modalServiceSpy: jasmine.SpyObj<CustomerModalService>;
  let nzModalSpy: jasmine.SpyObj<NzModalService>;
  let messageSpy: jasmine.SpyObj<NzMessageService>;

  const sampleCustomer: Customer = {
    id: 1,
    name: 'Acme',
    contact: 'tg:@a',
    remark: '',
    status: 'active',
    createdBy: 1,
    createdAt: '2026-01-01',
    hasActiveLicense: true,
    activeLicenseKey: 'ebt_xxx',
    lastSeenAt: null,
  };

  const sampleCredential: LicenseCredential = {
    customerId: 1,
    licenseKey: 'ebt_new',
    licenseSecret: 'sec',
    installCommand: 'curl | sh',
  };

  beforeEach(() => {
    dataServiceSpy = jasmine.createSpyObj<CustomerService>('CustomerService', [
      'listCustomers',
      'createCustomer',
      'updateCustomer',
      'revokeLicense',
      'reissueLicense',
      'getInstallCommand',
    ]);
    modalServiceSpy = jasmine.createSpyObj<CustomerModalService>('CustomerModalService', ['show']);
    nzModalSpy = jasmine.createSpyObj<NzModalService>('NzModalService', ['confirm']);
    messageSpy = jasmine.createSpyObj<NzMessageService>('NzMessageService', ['info', 'error']);

    dataServiceSpy.listCustomers.and.returnValue(
      of({ list: [sampleCustomer], total: 1, pageIndex: 1, pageSize: 10 }),
    );

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: CustomerService, useValue: dataServiceSpy },
        { provide: CustomerModalService, useValue: modalServiceSpy },
        { provide: NzModalService, useValue: nzModalSpy },
        { provide: NzMessageService, useValue: messageSpy },
      ],
    });
  });

  function createInstance(): CustomersComponent {
    const fixture = TestBed.createComponent(CustomersComponent);
    return fixture.componentInstance;
  }

  it('getDataList 调用 listCustomers 并把结果写入 signals', () => {
    const cmp = createInstance();
    cmp.searchParam = { name: '张', status: 'active' };

    cmp.getDataList({ pageIndex: 2 });

    expect(dataServiceSpy.listCustomers).toHaveBeenCalledOnceWith({
      pageSize: 10,
      pageIndex: 2,
      filters: { name: '张', status: 'active' },
    });
    expect(cmp.dataList()).toEqual([sampleCustomer]);
    expect(cmp.tableConfig().total).toBe(1);
  });

  it('add 在用户取消时不调用 createCustomer', () => {
    const cmp = createInstance();
    modalServiceSpy.show.and.returnValue(
      of({ status: ModalBtnStatus.Cancel, modalValue: null } as ModalResponse),
    );

    cmp.add();

    expect(dataServiceSpy.createCustomer).not.toHaveBeenCalled();
  });

  it('add 成功后打开凭据抽屉并刷新列表', () => {
    const cmp = createInstance();
    modalServiceSpy.show.and.returnValue(
      of({ status: ModalBtnStatus.Ok, modalValue: { name: 'Acme' } } as ModalResponse),
    );
    dataServiceSpy.createCustomer.and.returnValue(of(sampleCredential));
    // 重置 listCustomers 调用记录以便断言"add 后刷新"
    dataServiceSpy.listCustomers.calls.reset();

    cmp.add();

    expect(dataServiceSpy.createCustomer).toHaveBeenCalledOnceWith({ name: 'Acme' });
    expect(cmp.drawerVisible()).toBeTrue();
    expect(cmp.currentCredential).toEqual(sampleCredential);
    expect(dataServiceSpy.listCustomers).toHaveBeenCalled();
  });

  it('edit 成功后调用 updateCustomer 并刷新列表', () => {
    const cmp = createInstance();
    modalServiceSpy.show.and.returnValue(
      of({
        status: ModalBtnStatus.Ok,
        modalValue: { name: 'Acme2', status: 'suspended' },
      } as ModalResponse),
    );
    dataServiceSpy.updateCustomer.and.returnValue(of(undefined));

    cmp.edit(sampleCustomer);

    expect(dataServiceSpy.updateCustomer).toHaveBeenCalledOnceWith({
      id: 1,
      name: 'Acme2',
      status: 'suspended',
    });
  });

  it('revoke 确认后调用 revokeLicense；若未吊销任何 license 会 info', () => {
    const cmp = createInstance();
    nzModalSpy.confirm.and.callFake(((cfg: { nzOnOk?: () => void }) => {
      cfg.nzOnOk?.();
      return {} as ReturnType<NzModalService['confirm']>;
    }) as NzModalService['confirm']);
    dataServiceSpy.revokeLicense.and.returnValue(of({ revokedCount: 0 }));

    cmp.revoke(sampleCustomer);

    expect(dataServiceSpy.revokeLicense).toHaveBeenCalledOnceWith(1);
    expect(messageSpy.info).toHaveBeenCalled();
  });

  it('reissue 确认后调用 reissueLicense 并打开凭据抽屉', () => {
    const cmp = createInstance();
    nzModalSpy.confirm.and.callFake(((cfg: { nzOnOk?: () => void }) => {
      cfg.nzOnOk?.();
      return {} as ReturnType<NzModalService['confirm']>;
    }) as NzModalService['confirm']);
    dataServiceSpy.reissueLicense.and.returnValue(of(sampleCredential));

    cmp.reissue(sampleCustomer);

    expect(dataServiceSpy.reissueLicense).toHaveBeenCalledOnceWith(1);
    expect(cmp.drawerVisible()).toBeTrue();
    expect(cmp.currentCredential?.licenseKey).toBe('ebt_new');
  });

  it('viewInstallCommand 调用 getInstallCommand 并用 showSecret=false 打开抽屉', () => {
    const cmp = createInstance();
    dataServiceSpy.getInstallCommand.and.returnValue(of({ installCommand: 'curl X' }));

    cmp.viewInstallCommand(sampleCustomer);

    expect(dataServiceSpy.getInstallCommand).toHaveBeenCalledOnceWith(1);
    expect(cmp.drawerVisible()).toBeTrue();
    expect(cmp.drawerShowSecret).toBeFalse();
    expect(cmp.currentCredential?.installCommand).toBe('curl X');
    expect(cmp.currentCredential?.licenseSecret).toBe('');
  });

  it('onDrawerVisibleChange(false) 会清空 currentCredential', () => {
    const cmp = createInstance();
    cmp.currentCredential = sampleCredential;
    cmp.drawerVisible.set(true);

    cmp.onDrawerVisibleChange(false);

    expect(cmp.drawerVisible()).toBeFalse();
    expect(cmp.currentCredential).toBeNull();
  });

  it('resetForm 把 searchParam 还原为 status=all 并触发首页刷新', () => {
    const cmp = createInstance();
    cmp.searchParam = { name: '张三', status: 'suspended' };
    dataServiceSpy.listCustomers.calls.reset();

    cmp.resetForm();

    expect(cmp.searchParam).toEqual({ status: 'all' });
    expect(dataServiceSpy.listCustomers).toHaveBeenCalled();
    const arg = dataServiceSpy.listCustomers.calls.mostRecent().args[0];
    expect(arg.pageIndex).toBe(1);
    expect(arg.filters).toEqual({ status: 'all' });
  });
});
