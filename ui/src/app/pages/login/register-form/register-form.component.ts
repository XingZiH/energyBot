import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';

import { LoginService } from '@core/services/http/login/login.service';
import { fnCheckForm } from '@utils/tools';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzWaveModule } from 'ng-zorro-antd/core/wave';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';

@Component({
  selector: 'app-register-form',
  templateUrl: './register-form.component.html',
  styleUrl: './register-form.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NzFormModule, ReactiveFormsModule, NzGridModule, NzButtonModule, NzInputModule, NzWaveModule, RouterLink]
})
export class RegisterFormComponent implements OnInit {
  validateForm!: FormGroup;
  submitting = signal(false);
  messageService = inject(NzMessageService);
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private loginService = inject(LoginService);

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
        email: param.email
      })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe(() => {
        this.messageService.success('注册成功，请登录');
        this.router.navigateByUrl('login/login-form');
      });
  }

  ngOnInit(): void {
    this.validateForm = this.fb.group({
      userName: [null, [Validators.required]],
      agentName: [null, [Validators.required]],
      email: [null],
      mobile: [null],
      password: [null, [Validators.required, Validators.minLength(6)]],
      confirmPassword: [null, [Validators.required]]
    });
  }
}
