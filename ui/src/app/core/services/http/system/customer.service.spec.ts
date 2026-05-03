import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { BaseHttpService } from '../base-http.service';
import {
  Customer,
  CustomerDetail,
  CustomerService,
  LicenseCredential,
  RevokeLicenseResult,
} from './customer.service';

/**
 * CustomerService 的单元测试。
 *
 * 策略：直接 spy BaseHttpService，不走真实 HTTP 栈，测试聚焦路径、请求体与透传。
 * BaseHttpService 自带 prefix + 业务 code 解包，CustomerService 本身只做参数编排，
 * 因此 spy 层面的 mock 足够覆盖业务逻辑。
 */
describe('CustomerService', () => {
  let service: CustomerService;
  let httpSpy: jasmine.SpyObj<BaseHttpService>;

  beforeEach(() => {
    httpSpy = jasmine.createSpyObj<BaseHttpService>('BaseHttpService', [
      'get',
      'post',
      'put',
    ]);

    TestBed.configureTestingModule({
      providers: [
        CustomerService,
        { provide: BaseHttpService, useValue: httpSpy },
      ],
    });
    service = TestBed.inject(CustomerService);
  });

  it('listCustomers 应该 POST 到 /customer/list 并透传分页+过滤', done => {
    const fakePage = {
      list: [{ id: 1, name: '张三' } as Customer],
      total: 1,
      pageIndex: 1,
      pageSize: 10,
    };
    httpSpy.post.and.returnValue(of(fakePage));

    const param = { pageIndex: 1, pageSize: 10, filters: { name: '张' } };
    service.listCustomers(param).subscribe(res => {
      expect(res).toEqual(fakePage);
      expect(httpSpy.post).toHaveBeenCalledOnceWith(
        '/customer/list',
        param,
        jasmine.objectContaining({ showLoading: true }),
      );
      done();
    });
  });

  it('getCustomer 应该 GET 到 /customer/:id', done => {
    const fake = { id: 7, name: 'Acme', licenses: [] } as unknown as CustomerDetail;
    httpSpy.get.and.returnValue(of(fake));

    service.getCustomer(7).subscribe(res => {
      expect(res).toBe(fake);
      expect(httpSpy.get).toHaveBeenCalledOnceWith('/customer/7');
      done();
    });
  });

  it('createCustomer 应该 POST 到 /customer/create 并开启 needSuccessInfo', done => {
    const credential: LicenseCredential = {
      customerId: 1,
      licenseKey: 'ebt_abc',
      licenseSecret: 'sec',
      installCommand: 'curl ...',
    };
    httpSpy.post.and.returnValue(of(credential));

    service.createCustomer({ name: 'Acme' }).subscribe(res => {
      expect(res).toEqual(credential);
      expect(httpSpy.post).toHaveBeenCalledOnceWith(
        '/customer/create',
        { name: 'Acme' },
        jasmine.objectContaining({ needSuccessInfo: true }),
      );
      done();
    });
  });

  it('updateCustomer 应该 PUT 到 /customer/update', done => {
    httpSpy.put.and.returnValue(of(undefined));
    service.updateCustomer({ id: 1, name: '新名' }).subscribe(() => {
      expect(httpSpy.put).toHaveBeenCalledOnceWith(
        '/customer/update',
        { id: 1, name: '新名' },
        jasmine.objectContaining({ needSuccessInfo: true }),
      );
      done();
    });
  });

  it('revokeLicense 应该携带 customerId 与 reason', done => {
    const result: RevokeLicenseResult = { revokedCount: 1 };
    httpSpy.post.and.returnValue(of(result));

    service.revokeLicense(9, '合同到期').subscribe(res => {
      expect(res).toEqual(result);
      expect(httpSpy.post).toHaveBeenCalledOnceWith(
        '/customer/revoke-license',
        { customerId: 9, reason: '合同到期' },
        jasmine.objectContaining({ needSuccessInfo: true }),
      );
      done();
    });
  });

  it('revokeLicense 在不传 reason 时字段为 undefined（后端会按可选处理）', done => {
    httpSpy.post.and.returnValue(of({ revokedCount: 0 }));
    service.revokeLicense(2).subscribe(() => {
      const args = httpSpy.post.calls.mostRecent().args;
      expect(args[0]).toBe('/customer/revoke-license');
      expect(args[1]).toEqual({ customerId: 2, reason: undefined });
      done();
    });
  });

  it('reissueLicense 应该 POST 到 /customer/reissue-license 并返回新 credential', done => {
    const credential: LicenseCredential = {
      licenseKey: 'ebt_new',
      licenseSecret: 'new',
      installCommand: 'curl new',
    };
    httpSpy.post.and.returnValue(of(credential));

    service.reissueLicense(5).subscribe(res => {
      expect(res).toEqual(credential);
      expect(httpSpy.post).toHaveBeenCalledOnceWith(
        '/customer/reissue-license',
        { customerId: 5, reason: undefined },
        jasmine.objectContaining({ needSuccessInfo: true }),
      );
      done();
    });
  });

  it('getInstallCommand 应该 GET 到 /customer/:id/install-command', done => {
    httpSpy.get.and.returnValue(of({ installCommand: 'curl | sh' }));
    service.getInstallCommand(3).subscribe(res => {
      expect(res.installCommand).toBe('curl | sh');
      expect(httpSpy.get).toHaveBeenCalledOnceWith('/customer/3/install-command');
      done();
    });
  });
});
