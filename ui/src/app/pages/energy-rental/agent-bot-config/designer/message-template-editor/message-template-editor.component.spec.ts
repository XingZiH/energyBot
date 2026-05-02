import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { NZ_ICONS, NzIconModule } from 'ng-zorro-antd/icon';
import {
  CheckCircleOutline,
  CloseCircleOutline,
  ExclamationCircleOutline,
  InfoCircleOutline,
} from '@ant-design/icons-angular/icons';

import { MessageTemplates, createEmptyMessageTemplates } from '../types';
import { MessageTemplateEditorComponent } from './message-template-editor.component';
import {
  AVAILABLE_VARIABLES,
  SCENE_METADATA,
} from './template-constants';

// 后端 KnownVariables 的权威顺序——任何偏离都意味着前后端契约破裂。
// 修改此常量前必须同步更新 go-bot/internal/telegram/template/template.go
const EXPECTED_VARIABLE_NAMES = [
  'orderNo',
  'packageName',
  'amount',
  'energy',
  'address',
  'payAddress',
  'txHash',
  'botName',
  'bandwidth',
  'balance',
  'reason',
  'command',
] as const;

// MessageTemplates 的 9 个字段，用于穷举场景 tab
const EXPECTED_SCENE_KEYS: ReadonlyArray<keyof MessageTemplates> = [
  'welcome',
  'unknownCommand',
  'packageUnavailable',
  'addressInvalid',
  'orderCreated',
  'payPending',
  'paySuccess',
  'payFailed',
  'walletQueryResult',
];

/**
 * Host 组件：通过模板绑定 initialTemplates 和监听 templatesChange，
 * 方便测试 input 变化场景与 output 触发。
 */
@Component({
  standalone: true,
  imports: [MessageTemplateEditorComponent],
  template: `
    <app-message-template-editor
      [initialTemplates]="initialTemplates"
      (templatesChange)="onChange($event)"
    ></app-message-template-editor>
  `,
})
class HostComponent {
  @ViewChild(MessageTemplateEditorComponent)
  editor!: MessageTemplateEditorComponent;

  initialTemplates: MessageTemplates = createEmptyMessageTemplates();
  lastEmitted: MessageTemplates | null = null;

  onChange(tpl: MessageTemplates): void {
    this.lastEmitted = tpl;
  }
}

describe('MessageTemplateEditorComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let component: MessageTemplateEditorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, NzIconModule],
      providers: [
        {
          provide: NZ_ICONS,
          useValue: [
            CheckCircleOutline,
            CloseCircleOutline,
            ExclamationCircleOutline,
            InfoCircleOutline,
          ],
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    component = host.editor;
  });

  // ---------- 常量完整性断言 ----------

  it('1. SCENE_METADATA 恰好 9 项，且 key 与 MessageTemplates 字段一一对应', () => {
    expect(SCENE_METADATA.length).toBe(9);
    const keys = SCENE_METADATA.map((s) => s.key).sort();
    const expected = [...EXPECTED_SCENE_KEYS].sort();
    expect(keys).toEqual(expected);
  });

  it('2. AVAILABLE_VARIABLES 恰好 12 项', () => {
    expect(AVAILABLE_VARIABLES.length).toBe(12);
  });

  it('3. AVAILABLE_VARIABLES 的 name 顺序严格等于后端 KnownVariables', () => {
    // 这条断言防止前端被误改而脱离后端契约——
    // 任何调整请同步 go-bot/internal/telegram/template/template.go
    const names = AVAILABLE_VARIABLES.map((v) => v.name);
    expect(names).toEqual([...EXPECTED_VARIABLE_NAMES]);
  });

  it('4. SCENE_METADATA 每项 relevantVariables 都是 AVAILABLE_VARIABLES 的子集', () => {
    const whitelist = new Set(AVAILABLE_VARIABLES.map((v) => v.name));
    for (const scene of SCENE_METADATA) {
      for (const name of scene.relevantVariables) {
        expect(whitelist.has(name)).withContext(
          `场景 ${scene.key} 的推荐变量 ${name} 不在白名单内`,
        ).toBeTrue();
      }
    }
  });

  // ---------- 基础渲染 ----------

  it('5. 初始渲染：9 个场景 tab 全部存在（按 label 统计）', () => {
    const el = fixture.nativeElement as HTMLElement;
    const tabs = el.querySelectorAll('.ant-tabs-tab');
    expect(tabs.length).toBe(9);
    const labels = Array.from(tabs).map((t) => t.textContent?.trim() ?? '');
    for (const scene of SCENE_METADATA) {
      expect(labels.some((lbl) => lbl.includes(scene.label))).withContext(
        `缺少场景 tab: ${scene.label}`,
      ).toBeTrue();
    }
  });

  it('6. 默认激活 welcome 场景', () => {
    expect(component.$activeScene()).toBe('welcome');
    expect(component.$activeTabIndex()).toBe(0);
  });

  it('7. onTabChange 切换场景：$activeScene 更新', () => {
    component.onTabChange(4); // orderCreated
    expect(component.$activeScene()).toBe('orderCreated');
  });

  // ---------- 写入路径 ----------

  it('8. updateScene 修改 draft 并 emit templatesChange', () => {
    component.updateScene('welcome', '你好 {botName}');

    expect(component.$draft().welcome).toBe('你好 {botName}');
    expect(host.lastEmitted).not.toBeNull();
    expect(host.lastEmitted!.welcome).toBe('你好 {botName}');
  });

  it('9. updateScene 只修改指定字段，其他字段保持不变', () => {
    component.updateScene('welcome', 'A');
    component.updateScene('payFailed', 'B');

    const draft = component.$draft();
    expect(draft.welcome).toBe('A');
    expect(draft.payFailed).toBe('B');
    expect(draft.orderCreated).toBe('');
  });

  // ---------- 变量插入 ----------

  it('10. insertVariable 将 {name} 插入到光标位置（空文案）', () => {
    const fake = {
      selectionStart: 0,
      selectionEnd: 0,
      focus: () => {},
      setSelectionRange: () => {},
    } as unknown as HTMLTextAreaElement;

    component.insertVariable('welcome', 'botName', fake);

    expect(component.$draft().welcome).toBe('{botName}');
    expect(host.lastEmitted?.welcome).toBe('{botName}');
  });

  it('11. insertVariable 在光标中间插入：前后文本保留', () => {
    component.updateScene('welcome', '你好世界');
    const fake = {
      selectionStart: 2,
      selectionEnd: 2,
      focus: () => {},
      setSelectionRange: () => {},
    } as unknown as HTMLTextAreaElement;

    component.insertVariable('welcome', 'botName', fake);

    expect(component.$draft().welcome).toBe('你好{botName}世界');
  });

  it('12. insertVariable 替换选中区间：选区被 {name} 取代', () => {
    component.updateScene('welcome', '你好旧世界');
    const fake = {
      selectionStart: 2,
      selectionEnd: 3, // 选中"旧"
      focus: () => {},
      setSelectionRange: () => {},
    } as unknown as HTMLTextAreaElement;

    component.insertVariable('welcome', 'botName', fake);

    expect(component.$draft().welcome).toBe('你好{botName}世界');
  });

  // ---------- extractVariables 规则 ----------

  it('13. extractVariables 识别单个占位', () => {
    expect(component.extractVariables('你好 {botName}，欢迎')).toEqual([
      'botName',
    ]);
  });

  it('14. extractVariables 处理 {{ }} 转义：不算占位', () => {
    expect(component.extractVariables('{{escaped}}')).toEqual([]);
    expect(component.extractVariables('text {{a}} text')).toEqual([]);
  });

  it('15. extractVariables 识别未知变量名', () => {
    expect(component.extractVariables('{unknown}')).toEqual(['unknown']);
  });

  it('16. extractVariables 对空串返回空数组', () => {
    expect(component.extractVariables('')).toEqual([]);
  });

  it('17. extractVariables 孤立的 { 或非法标识符忽略', () => {
    // { 后跟非标识符首字符（数字 / 空白）—— 不识别
    expect(component.extractVariables('{ foo}')).toEqual([]);
    expect(component.extractVariables('{1abc}')).toEqual([]);
    // 未闭合
    expect(component.extractVariables('{abc')).toEqual([]);
  });

  // ---------- validateScene ----------

  it('18. validateScene 对含未知变量的文案返回非空数组', () => {
    component.updateScene('welcome', '{unknown} 你好 {alsoBad}');
    expect(component.validateScene('welcome')).toEqual(['unknown', 'alsoBad']);
  });

  it('19. validateScene 对只含已知变量的文案返回空数组', () => {
    component.updateScene(
      'orderCreated',
      '订单 {orderNo} 金额 {amount}，收地址 {address}',
    );
    expect(component.validateScene('orderCreated')).toEqual([]);
  });

  it('20. validateScene 对空字符串返回空数组', () => {
    component.updateScene('welcome', '');
    expect(component.validateScene('welcome')).toEqual([]);
  });

  it('21. validateScene 对重复未知变量只返回一次', () => {
    component.updateScene('welcome', '{foo} {foo} {bar}');
    expect(component.validateScene('welcome')).toEqual(['foo', 'bar']);
  });

  // ---------- initialTemplates 响应式同步 ----------

  it('22. initialTemplates 变化后 $draft 被重置', () => {
    component.updateScene('welcome', '本地改动');
    expect(component.$draft().welcome).toBe('本地改动');

    // 父组件替换 input
    host.initialTemplates = { ...createEmptyMessageTemplates(), welcome: '新初值' };
    fixture.detectChanges();

    expect(component.$draft().welcome).toBe('新初值');
  });

  // ---------- 未知变量 UI 提示 ----------

  it('23. 文案含未知变量时在 tab 标签侧渲染 warning-dot', () => {
    component.updateScene('welcome', '{totallyUnknown}');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // warning-dot 只在 welcome tab 上出现
    const dots = el.querySelectorAll('.warning-dot');
    expect(dots.length).toBeGreaterThan(0);
  });
});
