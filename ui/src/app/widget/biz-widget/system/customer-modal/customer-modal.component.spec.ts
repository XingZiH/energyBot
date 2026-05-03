import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { take } from 'rxjs/operators';

import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';

import { Customer } from '@services/system/customer.service';

import { CustomerModalComponent } from './customer-modal.component';

/**
 * CustomerModal 表单行为测试。
 *
 * 覆盖：
 * 1. 新建模式下隐藏 status 字段
 * 2. 编辑模式下 patch 原值并显示 status
 * 3. 必填 + 长度校验
 * 4. getCurrentValue：表单无效返回 false，有效返回 value
 */
describe('CustomerModalComponent', () => {
  async function setup(data?: Customer): Promise<ComponentFixture<CustomerModalComponent>> {
    await TestBed.configureTestingModule({
      imports: [CustomerModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: NZ_MODAL_DATA, useValue: data },
        { provide: NzModalRef, useValue: { close: jasmine.createSpy('close') } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CustomerModalComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('新建模式下 isEdit=false，status 控件被移除', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    expect(cmp.isEdit).toBeFalse();
    expect(cmp.addEditForm.get('status')).toBeNull();
    expect(cmp.addEditForm.get('name')).not.toBeNull();
  });

  it('编辑模式下 isEdit=true 且表单 patch 入参值', async () => {
    const fixture = await setup({
      id: 1,
      name: 'Acme',
      contact: 'tg:@a',
      remark: 'v1',
      status: 'suspended',
      createdBy: 1,
      createdAt: '2026-01-01',
      hasActiveLicense: true,
      activeLicenseKey: 'ebt_xxx',
      lastSeenAt: null,
    });
    const cmp = fixture.componentInstance;
    expect(cmp.isEdit).toBeTrue();
    expect(cmp.addEditForm.value.name).toBe('Acme');
    expect(cmp.addEditForm.value.status).toBe('suspended');
  });

  it('name 为空时 required 校验失败', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    cmp.addEditForm.patchValue({ name: '' });
    expect(cmp.addEditForm.get('name')?.hasError('required')).toBeTrue();
  });

  it('name 短于 2 字符时 minlength 校验失败', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    cmp.addEditForm.patchValue({ name: 'a' });
    expect(cmp.addEditForm.get('name')?.hasError('minlength')).toBeTrue();
  });

  it('getCurrentValue 在表单无效时返回 false', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    cmp.addEditForm.patchValue({ name: '' });

    cmp
      .getCurrentValue()
      .pipe(take(1))
      .subscribe(val => expect(val).toBeFalse());
  });

  it('getCurrentValue 在表单有效时返回 value', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    cmp.addEditForm.patchValue({ name: 'Acme', contact: 'tg', remark: '' });

    cmp
      .getCurrentValue()
      .pipe(take(1))
      .subscribe(val => {
        expect(val).toBeTruthy();
        expect(val.name).toBe('Acme');
      });
  });
});
