import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { PageInfo, SearchCommonVO } from '../../types';
import { BaseHttpService } from '../base-http.service';

/**
 * Customer 列表行（后端 customer.service#list 返回的 enriched 结构）。
 */
export interface Customer {
  id: number;
  name: string;
  contact: string | null;
  remark: string | null;
  status: 'active' | 'suspended';
  createdBy: number;
  createdAt: string | Date;
  /** 是否存在未吊销的 license */
  hasActiveLicense: boolean;
  /** 当前有效 license key（用于列表展示，非 secret） */
  activeLicenseKey: string | null;
  /** 当前有效 license 最近一次心跳时间（null 表示从未上线） */
  lastSeenAt: string | Date | null;
}

/**
 * Customer 详情（findById 返回体：客户字段 + licenses 历史）。
 */
export interface CustomerDetail {
  id: number;
  name: string;
  contact: string | null;
  remark: string | null;
  status: 'active' | 'suspended';
  createdBy: number;
  createdAt: string | Date;
  licenses: Array<{
    id: number;
    licenseKey: string;
    issuedAt: string | Date;
    revokedAt: string | Date | null;
    revokedReason: string | null;
    lastSeenAt: string | Date | null;
  }>;
}

export interface CreateCustomerParam {
  name: string;
  contact?: string;
  remark?: string;
}

export interface UpdateCustomerParam {
  id: number;
  name?: string;
  contact?: string;
  remark?: string;
  status?: 'active' | 'suspended';
}

export interface ListCustomerFilter {
  name?: string;
  status?: 'active' | 'suspended' | 'all';
}

/**
 * 颁发 / 重新颁发 license 时返回的一次性凭据。
 * 注意：licenseSecret 只在创建或 reveal 时下发，前端必须立刻展示并允许拷贝，
 * 关闭抽屉后不再能从列表或详情拿到。
 */
export interface LicenseCredential {
  customerId?: number;
  licenseKey: string;
  licenseSecret: string;
  installCommand: string;
}

/** revoke 请求返回：反映幂等性（0 表示无可吊销，1+ 表示实际吊销条数）。 */
export interface RevokeLicenseResult {
  revokedCount: number;
}

/**
 * Customer 后端交互服务。
 *
 * 约束：
 * - 所有写接口走 POST/PUT，列表按项目惯例使用 POST /customer/list
 * - needSuccessInfo 控制是否弹全局成功 toast；创建 / 吊销 / 重发 默认弹，
 *   以便操作员确认生效
 */
@Injectable({
  providedIn: 'root',
})
export class CustomerService {
  http = inject(BaseHttpService);

  public listCustomers(
    param: SearchCommonVO<ListCustomerFilter>,
  ): Observable<PageInfo<Customer>> {
    return this.http.post('/customer/list', param, {
      showLoading: true,
      loadingText: '请求中',
    });
  }

  public getCustomer(id: number): Observable<CustomerDetail> {
    return this.http.get(`/customer/${id}`);
  }

  public createCustomer(
    param: CreateCustomerParam,
  ): Observable<LicenseCredential> {
    return this.http.post('/customer/create', param, {
      needSuccessInfo: true,
    });
  }

  public updateCustomer(param: UpdateCustomerParam): Observable<void> {
    return this.http.put('/customer/update', param, { needSuccessInfo: true });
  }

  public revokeLicense(
    customerId: number,
    reason?: string,
  ): Observable<RevokeLicenseResult> {
    return this.http.post(
      '/customer/revoke-license',
      { customerId, reason },
      { needSuccessInfo: true },
    );
  }

  public reissueLicense(
    customerId: number,
    reason?: string,
  ): Observable<LicenseCredential> {
    return this.http.post(
      '/customer/reissue-license',
      { customerId, reason },
      { needSuccessInfo: true },
    );
  }

  /** 查看当前 license 的 install 命令（包含明文 secret，需 reveal 权限）。 */
  public getInstallCommand(
    customerId: number,
  ): Observable<{ installCommand: string }> {
    return this.http.get(`/customer/${customerId}/install-command`);
  }
}
