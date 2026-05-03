import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import { LoginService, UserSignupResult } from '@core/services/http/login/login.service';
import { LicenseCredential } from '@services/system/customer.service';
import { LicenseCredentialDrawerComponent } from '@app/shared/biz-components/license-credential-drawer/license-credential-drawer.component';
import { fnCheckForm } from '@utils/tools';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzWaveModule } from 'ng-zorro-antd/core/wave';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';

/**
 * 用户自助注册页。
 *
 * 注册流程（新设计）：
 * 1. 提交 form → POST /auth/signup
 * 2. 后端在同事务里创建 user + customer + license 并回填 user.customer_id
 * 3. 响应返回 licenseKey / licenseSecret / installCommand（一次性明文）
 * 4. 前端弹 LicenseCredentialDrawer 让用户复制并勾选"我已安全保存"
 * 5. 用户关闭抽屉后跳登录页
 *
 * 安全约束：
 * - licenseSecret 只在此处明文展示一次，关闭抽屉后无法再次拿到
 * - 抽屉在用户勾选确认前不允许关闭（组件内置行为）
 */
@Component({
  selector: 'app-register-form',
  templateUrl: './register-form.component.html',
  styleUrl: './register-form.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    NzFormModule,
    ReactiveFormsModule,
    NzGridModule,
    NzButtonModule,
    NzInputModule,
    NzWaveModule,
    RouterLink,
    LicenseCredentialDrawerComponent,
  ],
})
export class RegisterFormComponent implements OnInit {
  validateForm!: FormGroup;
  submitting = signal(false);
  messageService = inject(NzMessageService);
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private loginService = inject(LoginService);

  /** 注册成功后缓存的一次性凭据；抽屉由此驱动 */
  readonly credential = signal<LicenseCredential | null>(null);
  readonly drawerVisible = signal(false);

  submitForm(): void {
    const invalid = fnCheckForm(this.validateForm);
    if (!invalid) {
      return;
    }
    const param = this.validateForm.getRawValue();
    if (param.password !== param.confirmPassword) {
      this.messageService.warning('两次输入的密码不一致');
      return;
    }
    this.submitting.set(true);
    this.loginService
      .signup({
        userName: param.userName,
        password: param.password,
        agentName: param.agentName,
        mobile: param.mobile,
        email: param.email,
      })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe((res: UserSignupResult) => {
        this.messageService.success('注册成功，请务必保存下方 License 凭据');
        this.credential.set({
          customerId: res.customerId,
          licenseKey: res.licenseKey,
          licenseSecret: res.licenseSecret,
          installCommand: res.installCommand,
        });
        this.drawerVisible.set(true);
      });
  }

  /**
   * 凭据抽屉关闭（用户已勾选确认）后跳登录页。
   * 用户若强制关闭浏览器而不勾选，下次只能通过 reveal 拿到 installCommand（secret 不可逆）。
   */
  onDrawerClose(visible: boolean): void {
    this.drawerVisible.set(visible);
    if (!visible) {
      this.router.navigateByUrl('login/login-form');
    }
  }

  ngOnInit(): void {
    this.validateForm = this.fb.group({
      userName: [null, [Validators.required]],
      agentName: [null, [Validators.required]],
      email: [null],
      mobile: [null],
      password: [null, [Validators.required, Validators.minLength(6)]],
      confirmPassword: [null, [Validators.required]],
    });
  }
}
