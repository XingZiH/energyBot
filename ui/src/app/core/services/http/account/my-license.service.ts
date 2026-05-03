import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { BaseHttpService } from '../base-http.service';

/**
 * 终端客户自助「我的 License」视图模型。
 *
 * 与后端 my-license.service.ts#MyLicenseView 保持一致；
 * 时间字段统一是 ISO-8601 字符串（后端 toISOString()），前端渲染前走 DatePipe。
 */
export interface MyLicenseView {
  customerId: number;
  customerName: string;
  customerStatus: 'active' | 'suspended';
  licenseKey: string | null;
  licenseStatus: 'active' | 'revoked' | 'none';
  issuedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
}

/**
 * 「我的 License」终端用户自助服务。
 *
 * 设计：
 * - 不接受任何 userId/customerId 入参——后端只信 JWT.userId
 * - 安装命令走独立端点，单独要权限 default:account:my-license:reveal
 */
@Injectable({ providedIn: 'root' })
export class MyLicenseService {
  http = inject(BaseHttpService);

  public findMine(): Observable<MyLicenseView> {
    return this.http.get('/my-license');
  }

  public getInstallCommand(): Observable<{ installCommand: string }> {
    return this.http.get('/my-license/install-command');
  }
}
