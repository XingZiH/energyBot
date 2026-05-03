import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, of } from 'rxjs';

import { Customer } from '@services/system/customer.service';
import { fnCheckForm } from '@utils/tools';
import { BasicConfirmModalComponent } from '@widget/base-modal';

import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
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
 * - createLogin / loginUserName / loginPassword：仅新建模式显示，勾选后
 *   后端会在同事务里创建终端客户登录账号并绑定到 customers.id
 *
 * 新建提交后由调用方弹凭据抽屉展示 installCommand，本组件不持有 license 相关字段。
 */
@Component({
  selector: 'app-customer-modal',
  templateUrl: './customer-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    NzFormModule,
    NzGridModule,
    NzInputModule,
    NzRadioModule,
    NzCheckboxModule,
  ],
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
    // 提交前清理掉 createLogin 开关本身（后端 DTO 不认这个字段），
    // 同时若用户未勾选，剥除 loginUserName / loginPassword 避免后端误解读
    const value = { ...this.addEditForm.value };
    const shouldCreateLogin = value.createLogin === true;
    delete value.createLogin;
    if (!shouldCreateLogin) {
      delete value.loginUserName;
      delete value.loginPassword;
    }
    return of(value);
  }

  initForm(): void {
    this.addEditForm = this.fb.group({
      name: [null, [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
      contact: [null, [Validators.maxLength(255)]],
      remark: [null, [Validators.maxLength(2000)]],
      status: ['active'],
      createLogin: [false],
      loginUserName: [null, [Validators.minLength(3), Validators.maxLength(64)]],
      loginPassword: [null, [Validators.minLength(6), Validators.maxLength(64)]],
    });

    // createLogin 切换时动态调整 loginUserName/loginPassword 的 required
    this.addEditForm.get('createLogin')!.valueChanges.subscribe((on: boolean) => {
      const name = this.addEditForm.get('loginUserName')!;
      const pwd = this.addEditForm.get('loginPassword')!;
      if (on) {
        name.addValidators(Validators.required);
        pwd.addValidators(Validators.required);
      } else {
        name.removeValidators(Validators.required);
        pwd.removeValidators(Validators.required);
        name.reset(null);
        pwd.reset(null);
      }
      name.updateValueAndValidity();
      pwd.updateValueAndValidity();
    });
  }

  ngOnInit(): void {
    this.initForm();
    this.isEdit = !!this.nzModalData;
    if (this.isEdit) {
      this.addEditForm.patchValue(this.nzModalData);
      // 编辑模式不允许改登录账号（未来独立接口处理）
      this.addEditForm.removeControl('createLogin');
      this.addEditForm.removeControl('loginUserName');
      this.addEditForm.removeControl('loginPassword');
    } else {
      // 新建模式隐藏 status，不参与提交
      this.addEditForm.removeControl('status');
    }
  }
}
