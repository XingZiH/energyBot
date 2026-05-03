import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';

import { Clipboard } from '@angular/cdk/clipboard';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { LicenseCredential } from '@services/system/customer.service';

import { LicenseCredentialDrawerComponent } from './license-credential-drawer.component';

/**
 * License 凭据抽屉的行为测试。
 *
 * 关键断言：
 * - 未勾选"已保存"时关闭行为会阻断，并弹出 NzModalService.warning
 * - 勾选后关闭会发出 visibleChange=false 并重置 confirmed
 * - copy() 调用 Clipboard.copy 并根据结果触发 message.success / error
 * - credential 为 null 时组件不崩
 */
@Component({
  standalone: true,
  imports: [LicenseCredentialDrawerComponent, FormsModule],
  template: `
    <app-license-credential-drawer
      [visible]="visible()"
      [credential]="credential"
      [showSecret]="showSecret"
      (visibleChange)="onVisibleChange($event)"
    ></app-license-credential-drawer>
  `,
})
class HostComponent {
  visible = signal(true);
  credential: LicenseCredential | null = null;
  showSecret = true;
  readonly visibleChangeSpy = jasmine.createSpy('visibleChange');
  onVisibleChange(v: boolean): void {
    this.visibleChangeSpy(v);
    this.visible.set(v);
  }
}

describe('LicenseCredentialDrawerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let clipboardSpy: jasmine.SpyObj<Clipboard>;
  let messageSpy: jasmine.SpyObj<NzMessageService>;
  let modalSpy: jasmine.SpyObj<NzModalService>;

  beforeEach(async () => {
    clipboardSpy = jasmine.createSpyObj<Clipboard>('Clipboard', ['copy']);
    messageSpy = jasmine.createSpyObj<NzMessageService>('NzMessageService', [
      'success',
      'error',
      'warning',
    ]);
    modalSpy = jasmine.createSpyObj<NzModalService>('NzModalService', ['warning']);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Clipboard, useValue: clipboardSpy },
        { provide: NzMessageService, useValue: messageSpy },
        { provide: NzModalService, useValue: modalSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function getDrawer(): LicenseCredentialDrawerComponent {
    return fixture.debugElement.query(By.directive(LicenseCredentialDrawerComponent))
      .componentInstance as LicenseCredentialDrawerComponent;
  }

  it('初始渲染不崩（credential=null）', () => {
    fixture.detectChanges();
    expect(getDrawer()).toBeTruthy();
    expect(getDrawer().confirmed()).toBeFalse();
  });

  it('未勾选确认时 onClose 会调用 modal.warning 且不触发 visibleChange', () => {
    host.credential = {
      licenseKey: 'ebt_abc',
      licenseSecret: 'sec',
      installCommand: 'curl ...',
    };
    fixture.detectChanges();

    const drawer = getDrawer();
    drawer.onClose();

    expect(modalSpy.warning).toHaveBeenCalled();
    expect(host.visibleChangeSpy).not.toHaveBeenCalled();
  });

  it('勾选确认后 onClose 触发 visibleChange=false 并重置 confirmed', () => {
    host.credential = {
      licenseKey: 'ebt_abc',
      licenseSecret: 'sec',
      installCommand: 'curl ...',
    };
    fixture.detectChanges();

    const drawer = getDrawer();
    drawer.confirmed.set(true);
    drawer.onClose();

    expect(host.visibleChangeSpy).toHaveBeenCalledOnceWith(false);
    expect(drawer.confirmed()).toBeFalse();
  });

  it('copy 成功时调用 message.success', () => {
    fixture.detectChanges();
    clipboardSpy.copy.and.returnValue(true);

    getDrawer().copy('hello', 'License Key');

    expect(clipboardSpy.copy).toHaveBeenCalledWith('hello');
    expect(messageSpy.success).toHaveBeenCalled();
  });

  it('copy 失败时调用 message.error', () => {
    fixture.detectChanges();
    clipboardSpy.copy.and.returnValue(false);

    getDrawer().copy('hello', 'License Secret');

    expect(messageSpy.error).toHaveBeenCalled();
  });

  it('copy 传入空值时提示 warning，不调用 clipboard', () => {
    fixture.detectChanges();

    getDrawer().copy(null, '安装命令');

    expect(clipboardSpy.copy).not.toHaveBeenCalled();
    expect(messageSpy.warning).toHaveBeenCalled();
  });

  it('canClose 计算属性跟随 confirmed', () => {
    fixture.detectChanges();
    const drawer = getDrawer();
    expect(drawer.canClose()).toBeFalse();
    drawer.confirmed.set(true);
    expect(drawer.canClose()).toBeTrue();
  });
});
