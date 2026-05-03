import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, of } from 'rxjs';

import { Customer } from '@services/system/customer.service';
import { fnCheckForm } from '@utils/tools';
import { BasicConfirmModalComponent } from '@widget/base-modal';

import { NzSafeAny } from 'ng-zorro-antd/core/types';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzRadioModule } from 'ng-zorro-antd/radio';

/**
 * Customer 新建 / 编辑表单。
 *
 * 字段设计：
 * - name：2-120 字符，必填；与后端 CreateCustomerDto 校验对齐
 * - contact：可选 255 字；自由文本（Telegram / 邮箱 / 电话）
 * - remark：可选 2000 字；合同号 / 销售跟进等
 * - status：仅编辑模式显示；新建时由后端默认 active
 *
 * 新建提交后由调用方弹凭据抽屉展示 installCommand，本组件不持有 license 相关字段。
 */
@Component({
  selector: 'app-customer-modal',
  templateUrl: './customer-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ReactiveFormsModule, NzFormModule, NzGridModule, NzInputModule, NzRadioModule],
})
export class CustomerModalComponent extends BasicConfirmModalComponent implements OnInit {
  addEditForm!: FormGroup;
  readonly nzModalData: Customer = inject(NZ_MODAL_DATA);
  isEdit = false;

  private fb = inject(FormBuilder);
  override modalRef = inject(NzModalRef);

  override getCurrentValue(): Observable<NzSafeAny> {
    if (!fnCheckForm(this.addEditForm)) {
      return of(false);
    }
    return of(this.addEditForm.value);
  }

  initForm(): void {
    this.addEditForm = this.fb.group({
      name: [null, [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
      contact: [null, [Validators.maxLength(255)]],
      remark: [null, [Validators.maxLength(2000)]],
      status: ['active'],
    });
  }

  ngOnInit(): void {
    this.initForm();
    this.isEdit = !!this.nzModalData;
    if (this.isEdit) {
      this.addEditForm.patchValue(this.nzModalData);
    } else {
      // 新建模式隐藏 status，不参与提交
      this.addEditForm.removeControl('status');
    }
  }
}
