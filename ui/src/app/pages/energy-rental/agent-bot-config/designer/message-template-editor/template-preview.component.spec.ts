/**
 * TemplatePreviewComponent 单元测试（任务 24）。
 *
 * 覆盖：
 * - input 响应式：template / variables 变化 → $rendered 更新
 * - 默认变量：variables 为空时，使用 AVAILABLE_VARIABLES.example
 * - input variables 覆盖默认
 * - $isEmpty：空串与纯空白
 * - DOM 分段渲染：var / unknown / escape 样式类
 * - showLegend：false 时不渲染图例
 * - 中文模板支持
 */

import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NZ_ICONS, NzIconModule } from 'ng-zorro-antd/icon';
import {
  EyeOutline,
  InfoCircleOutline,
} from '@ant-design/icons-angular/icons';

import { TemplatePreviewComponent } from './template-preview.component';
import { AVAILABLE_VARIABLES } from './template-constants';

@Component({
  standalone: true,
  imports: [TemplatePreviewComponent],
  template: `
    <app-template-preview
      [template]="tpl()"
      [variables]="vars()"
      [showLegend]="showLegend()"
    ></app-template-preview>
  `,
})
class HostComponent {
  tpl: WritableSignal<string> = signal('');
  vars: WritableSignal<Record<string, string>> = signal({});
  showLegend: WritableSignal<boolean> = signal(true);
}

describe('TemplatePreviewComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, NzIconModule],
      providers: [
        {
          provide: NZ_ICONS,
          useValue: [EyeOutline, InfoCircleOutline],
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  // ---------- 空态 ----------

  it('1. template 为空串时展示空态 nz-empty', () => {
    host.tpl.set('');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nz-empty')).toBeTruthy();
    expect(el.querySelector('.preview-content')).toBeNull();
  });

  it('2. template 为纯空白（空格 / 换行）仍视为空态', () => {
    host.tpl.set('   \n\t  ');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nz-empty')).toBeTruthy();
  });

  // ---------- 默认变量样例值 ----------

  it('3. variables 为空时使用 AVAILABLE_VARIABLES.example 作为默认值', () => {
    host.tpl.set('订单号 {orderNo}');
    host.vars.set({});
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const varEl = el.querySelector('.seg-var');
    const expectedExample = AVAILABLE_VARIABLES.find(
      (v) => v.name === 'orderNo',
    )!.example;
    expect(varEl?.textContent?.trim()).toBe(expectedExample);
  });

  it('4. variables 覆盖默认样例值', () => {
    host.tpl.set('订单号 {orderNo}');
    host.vars.set({ orderNo: 'ORD-TEST-001' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const varEl = el.querySelector('.seg-var');
    expect(varEl?.textContent?.trim()).toBe('ORD-TEST-001');
  });

  // ---------- 分段 DOM ----------

  it('5. 已知变量渲染为 .seg-var', () => {
    host.tpl.set('{botName}');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.seg-var')).toBeTruthy();
    expect(el.querySelector('.seg-unknown')).toBeNull();
  });

  it('6. 未知变量渲染为 .seg-unknown 且保留原始占位文本', () => {
    host.tpl.set('{totallyUnknownXYZ}');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const unk = el.querySelector('.seg-unknown');
    expect(unk).toBeTruthy();
    expect(unk?.textContent?.trim()).toBe('{totallyUnknownXYZ}');
  });

  it('7. 转义字符 {{ 渲染为 .seg-escape', () => {
    host.tpl.set('{{');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const esc = el.querySelector('.seg-escape');
    expect(esc).toBeTruthy();
    expect(esc?.textContent?.trim()).toBe('{');
  });

  it('8. 纯文本+中文+已知变量混合渲染正确', () => {
    host.tpl.set('订单 {orderNo} 已完成');
    host.vars.set({ orderNo: 'O9' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const content = el.querySelector('.preview-content');
    expect(content?.textContent).toContain('订单');
    expect(content?.textContent).toContain('O9');
    expect(content?.textContent).toContain('已完成');
  });

  // ---------- 响应式更新 ----------

  it('9. template 变化后 DOM 实时更新', () => {
    host.tpl.set('A {orderNo} B');
    host.vars.set({ orderNo: '1' });
    fixture.detectChanges();

    let el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.seg-var')?.textContent?.trim()).toBe('1');

    host.tpl.set('C {orderNo} D');
    host.vars.set({ orderNo: '2' });
    fixture.detectChanges();

    el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.seg-var')?.textContent?.trim()).toBe('2');
  });

  // ---------- 图例 ----------

  it('10. showLegend = true 渲染图例', () => {
    host.tpl.set('{orderNo}');
    host.showLegend.set(true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.preview-legend')).toBeTruthy();
  });

  it('11. showLegend = false 不渲染图例', () => {
    host.tpl.set('{orderNo}');
    host.showLegend.set(false);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.preview-legend')).toBeNull();
  });

  // ---------- 合并变量字典 ----------

  it('12. mergedVariables 合并默认 + 外部输入（外部优先）', () => {
    host.tpl.set('{orderNo} / {packageName}');
    host.vars.set({ orderNo: 'CUSTOM' }); // 只覆盖一个
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const vars = el.querySelectorAll('.seg-var');
    expect(vars.length).toBe(2);
    expect(vars[0].textContent?.trim()).toBe('CUSTOM');
    // packageName 继续使用默认 example
    const defaultPackage = AVAILABLE_VARIABLES.find(
      (v) => v.name === 'packageName',
    )!.example;
    expect(vars[1].textContent?.trim()).toBe(defaultPackage);
  });
});
