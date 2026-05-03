import { inject, Injectable, Type } from '@angular/core';
import { Observable } from 'rxjs';

import { Customer } from '@services/system/customer.service';
import { ModalResponse, ModalWrapService } from '@widget/base-modal';
import { CustomerModalComponent } from '@widget/biz-widget/system/customer-modal/customer-modal.component';

import { ModalOptions } from 'ng-zorro-antd/modal';

/**
 * Customer 新建 / 编辑表单的包装服务。
 *
 * 传入 modalData（Customer 行数据）即视为编辑模式；不传则为新增。
 * 与同目录下其它 system modal 保持同构，调用方只需处理 Observable<ModalResponse>。
 */
@Injectable({
  providedIn: 'root',
})
export class CustomerModalService {
  private modalWrapService = inject(ModalWrapService);

  protected getContentComponent(): Type<CustomerModalComponent> {
    return CustomerModalComponent;
  }

  public show(
    modalOptions: ModalOptions = {},
    modalData?: Customer,
  ): Observable<ModalResponse> {
    return this.modalWrapService.show<CustomerModalComponent, Customer>(
      this.getContentComponent(),
      modalOptions,
      modalData,
    );
  }
}
