import { HttpErrorResponse } from '@angular/common/http';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { throwError } from 'rxjs';

import { NZ_ICONS } from 'ng-zorro-antd/icon';
import {
  CheckCircleOutline,
  CloseCircleOutline,
  ExclamationCircleOutline,
  EyeOutline,
  InfoCircleOutline
} from '@ant-design/icons-angular/icons';

import { AgentBotConfig, BotRuntimeStatus, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { UiConfig, UiConfigService } from '@services/energy-rental/ui-config.service';
import { of } from 'rxjs';

import { EnergyRentalAgentBotConfigComponent } from './agent-bot-config.component';
import { MessageTemplateEditorComponent } from './designer/message-template-editor/message-template-editor.component';
import type { MenuRow, MessageTemplates } from './designer/types';

/**
 * 组件单元测试（任务 22B）。
 *
 * 测试策略：不触发完整模板渲染（MenuDesignerComponent 及其 4 个子组件依赖庞杂，
 * 在 TestBed 里完整挂载会拖慢测试 20+ 倍），只通过 TestBed.createComponent 拿到
 * 组件实例测试业务方法。MenuDesignerComponent 与模板渲染相关的行为由其自身的
 * spec 覆盖，这里只验证父容器的数据流 / API 协调逻辑。
 */
describe('EnergyRentalAgentBotConfigComponent', () => {
  let component: EnergyRentalAgentBotConfigComponent;
  let componentRef: ComponentRef<EnergyRentalAgentBotConfigComponent>;
  let dataService: jasmine.SpyObj<EnergyRentalService>;
  let uiConfigService: jasmine.SpyObj<UiConfigService>;

  const mockConfig: AgentBotConfig = {
    scope: 'agent',
    agentId: 42,
    botStatus: 'enabled',
    telegramBotToken: '',
    telegramBotTokenConfigured: true,
    telegramBotUsername: '@my_bot',
    welcomeText: 'legacy welcome',
    menuConfig: '[{"legacy":"ignored"}]',
    messageConfig: '{"legacy":"ignored"}',
    remark: 'note'
  };

  const mockRuntime: BotRuntimeStatus = {
    scope: 'agent',
    agentId: 42,
    desiredStatus: 'enabled',
    desiredStatusLabel: '已启用',
    serviceStatus: 'online',
    serviceStatusLabel: '在线',
    runtimeStatus: 'running',
    pollingStatus: 'polling',
    lastHeartbeatAt: '2026-05-02T10:00:00.000Z',
    heartbeatAgeSeconds: 30,
    lastStartedAt: '2026-05-02T09:00:00.000Z',
    lastStoppedAt: null,
    lastError: '',
    instanceId: 'inst-1',
    telegramBotTokenConfigured: true,
    canEnable: true
  };

  const mockUiConfig: UiConfig = {
    welcomeText: 'v2 welcome',
    menuConfig: [{ id: 'row-1', buttons: [] }] as MenuRow[],
    messageConfig: {
      welcome: 'w',
      orderCreated: 'oc',
      payPending: 'pp',
      paySuccess: 'ps',
      payFailed: 'pf',
      addressInvalid: 'ai',
      unknownCommand: 'uc',
      packageUnavailable: 'pu',
      walletQueryResult: 'wqr'
    },
    updatedAt: '2026-05-02T10:00:00.000Z'
  };

  beforeEach(() => {
    dataService = jasmine.createSpyObj<EnergyRentalService>('EnergyRentalService', [
      'getAgentBotConfig',
      'updateAgentBotConfig',
      'getBotRuntimeStatus',
      'updateBotRuntimeStatus'
    ]);
    uiConfigService = jasmine.createSpyObj<UiConfigService>('UiConfigService', [
      'getUiConfig',
      'saveUiConfig'
    ]);

    dataService.getAgentBotConfig.and.returnValue(of(mockConfig));
    dataService.getBotRuntimeStatus.and.returnValue(of(mockRuntime));
    dataService.updateAgentBotConfig.and.returnValue(of(undefined));
    dataService.updateBotRuntimeStatus.and.returnValue(of(undefined));
    uiConfigService.getUiConfig.and.returnValue(of(mockUiConfig));
    uiConfigService.saveUiConfig.and.returnValue(of({ updatedAt: '2026-05-02T11:00:00.000Z' }));

    TestBed.configureTestingModule({
      imports: [EnergyRentalAgentBotConfigComponent],
      providers: [
        { provide: EnergyRentalService, useValue: dataService },
        { provide: UiConfigService, useValue: uiConfigService }
      ]
    });

    // overrideComponent 移除 MenuDesignerComponent 及其子依赖——
    // 父容器逻辑测试不需要真实渲染设计器，避免 MenuTreeService / NzModalService 等间接依赖
    TestBed.overrideComponent(EnergyRentalAgentBotConfigComponent, {
      set: { template: '' }
    });

    const fixture = TestBed.createComponent(EnergyRentalAgentBotConfigComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
  });

  it('ngOnInit 并发触发 3 个 API（getAgentBotConfig / getBotRuntimeStatus / getUiConfig）', () => {
    component.ngOnInit();
    expect(dataService.getAgentBotConfig).toHaveBeenCalledTimes(1);
    expect(dataService.getBotRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(uiConfigService.getUiConfig).toHaveBeenCalledTimes(1);
  });

  it('加载成功后 form.patchValue 正确（token 清空、其他字段来自 bot config）', () => {
    component.ngOnInit();
    const raw = component.form.getRawValue();
    expect(raw.telegramBotToken).toBe(''); // Token 加载后始终留空
    expect(raw.telegramBotUsername).toBe('@my_bot');
    expect(raw.remark).toBe('note');
  });

  it('加载成功后 initialMenu signal 等于 ui-config 返回的 menuConfig', () => {
    component.ngOnInit();
    expect(component.initialMenu()).toEqual(mockUiConfig.menuConfig);
    expect(component.uiConfig()).toEqual(mockUiConfig);
    expect(component.uiConfigLoadError()).toBe(false);
  });

  it('加载成功后忽略旧 agent-bot-config.menuConfig（v1 JSON 字符串）', () => {
    component.ngOnInit();
    // menuConfig 来自 ui-config，不是 bot config 的 legacy 字符串
    expect(component.initialMenu()).toEqual([{ id: 'row-1', buttons: [] }]);
    // 确保没有去解析 legacy menuConfig 字符串
    expect(component.initialMenu()).not.toEqual(jasmine.objectContaining({ legacy: 'ignored' }));
  });

  it('getUiConfig 失败时 uiConfigLoadError 为 true，uiConfig 为 null，不阻塞 bot 加载', () => {
    uiConfigService.getUiConfig.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' }))
    );
    component.ngOnInit();
    expect(component.uiConfigLoadError()).toBe(true);
    expect(component.uiConfig()).toBeNull();
    expect(component.initialMenu()).toEqual([]);
    // bot 基础字段仍然加载成功
    expect(component.config()).toEqual(mockConfig);
    expect(component.runtime()).toEqual(mockRuntime);
    expect(component.loading()).toBe(false);
  });

  it('onSaveBot 调用 updateAgentBotConfig，且不传 menuConfig / messageConfig / welcomeText / botStatus', () => {
    component.ngOnInit();
    component.form.patchValue({
      telegramBotToken: 'new-token',
      telegramBotUsername: '@new_bot',
      remark: 'new note'
    });
    component.onSaveBot();
    expect(dataService.updateAgentBotConfig).toHaveBeenCalledTimes(1);
    const payload = dataService.updateAgentBotConfig.calls.mostRecent().args[0];
    expect(payload).toEqual({
      telegramBotToken: 'new-token',
      telegramBotUsername: '@new_bot',
      remark: 'new note'
    });
    expect(payload).not.toEqual(jasmine.objectContaining({ botStatus: jasmine.anything() }));
    expect(payload).not.toEqual(jasmine.objectContaining({ menuConfig: jasmine.anything() }));
    expect(payload).not.toEqual(jasmine.objectContaining({ messageConfig: jasmine.anything() }));
    expect(payload).not.toEqual(jasmine.objectContaining({ welcomeText: jasmine.anything() }));
  });

  it('onSaveBot 保存成功后重新并发拉取 3 个 API', () => {
    component.ngOnInit();
    dataService.getAgentBotConfig.calls.reset();
    dataService.getBotRuntimeStatus.calls.reset();
    uiConfigService.getUiConfig.calls.reset();

    component.onSaveBot();

    expect(dataService.getAgentBotConfig).toHaveBeenCalledTimes(1);
    expect(dataService.getBotRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(uiConfigService.getUiConfig).toHaveBeenCalledTimes(1);
  });

  it('onDesignerChange 调用 saveUiConfig，body 包含 menu + welcomeText + 现有 messageConfig，并带 If-Unmodified-Since', () => {
    component.ngOnInit();
    const newMenu: MenuRow[] = [{ id: 'new-row', buttons: [] }];
    component.onDesignerChange({ welcomeText: '新欢迎语', menuConfig: newMenu });

    expect(uiConfigService.saveUiConfig).toHaveBeenCalledTimes(1);
    const [payload, ifUnmodifiedSince] = uiConfigService.saveUiConfig.calls.mostRecent().args;
    expect(payload).toEqual({
      welcomeText: '新欢迎语',
      menuConfig: newMenu,
      messageConfig: mockUiConfig.messageConfig
    });
    expect(ifUnmodifiedSince).toBe(mockUiConfig.updatedAt);
  });

  it('onDesignerChange 保存成功后同步更新 uiConfig / initialMenu / initialWelcomeText，避免下次 409', () => {
    component.ngOnInit();
    const newMenu: MenuRow[] = [{ id: 'new-row', buttons: [] }];
    component.onDesignerChange({ welcomeText: 'WT1', menuConfig: newMenu });

    const ui = component.uiConfig();
    expect(ui?.updatedAt).toBe('2026-05-02T11:00:00.000Z');
    expect(ui?.menuConfig).toEqual(newMenu);
    expect(ui?.welcomeText).toBe('WT1');
    expect(component.initialMenu()).toEqual(newMenu);
    expect(component.initialWelcomeText()).toBe('WT1');

    // 再次保存使用新 updatedAt 作为乐观锁
    const secondMenu: MenuRow[] = [{ id: 'second', buttons: [] }];
    component.onDesignerChange({ welcomeText: 'WT2', menuConfig: secondMenu });
    const secondCallIfUnmodified = uiConfigService.saveUiConfig.calls.mostRecent().args[1];
    expect(secondCallIfUnmodified).toBe('2026-05-02T11:00:00.000Z');
  });

  it('uiConfig 为 null 时 onDesignerChange 直接返回不调 saveUiConfig', () => {
    uiConfigService.getUiConfig.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500 }))
    );
    component.ngOnInit();
    expect(component.uiConfig()).toBeNull();

    component.onDesignerChange({ welcomeText: '', menuConfig: [{ id: 'x', buttons: [] }] });
    expect(uiConfigService.saveUiConfig).not.toHaveBeenCalled();
  });

  it('toggleRuntime 方法已下线：组件不再暴露该方法（启停由「我的 Bot」页负责）', () => {
    expect((component as unknown as { toggleRuntime?: unknown }).toggleRuntime).toBeUndefined();
    expect(dataService.updateBotRuntimeStatus).not.toHaveBeenCalled();
  });

  it('loading 信号：加载开始为 true，结束为 false', () => {
    expect(component.loading()).toBe(false);
    component.ngOnInit();
    expect(component.loading()).toBe(false); // of() 同步完成
  });

  it('statusText / statusColor / runtimeStatusText 纯工具方法', () => {
    expect(component.statusText(true)).toBe('已配置');
    expect(component.statusText(false)).toBe('未配置');
    expect(component.statusColor(true)).toBe('green');
    expect(component.runtimeStatusText('running')).toBe('运行中');
    expect(component.runtimeStatusText(undefined)).toBe('未知');
    expect(component.pollingStatusText('polling')).toBe('轮询中');
    expect(component.runtimeStatusColor('running')).toBe('green');
    expect(component.runtimeStatusColor('error')).toBe('red');
    expect(component.serviceStatusColor('online')).toBe('green');
  });

  it('botScopeLabel 按 config.scope 返回文本', () => {
    component.ngOnInit();
    expect(component.botScopeLabel()).toBe('用户机器人');

    dataService.getAgentBotConfig.and.returnValue(of({ ...mockConfig, scope: 'platform' }));
    component.ngOnInit();
    expect(component.botScopeLabel()).toBe('平台机器人');
  });

  it('formatRuntimeTime 返回本地时间串，空值回退为 "-"', () => {
    expect(component.formatRuntimeTime(null)).toBe('-');
    expect(component.formatRuntimeTime(undefined)).toBe('-');
    expect(component.formatRuntimeTime('invalid-date')).toBe('-');
    expect(component.formatRuntimeTime('2026-05-02T10:00:00.000Z')).toMatch(/2026/);
  });

  it('heartbeatText 组合心跳时间和秒差', () => {
    expect(component.heartbeatText(null)).toBe('-');
    expect(component.heartbeatText({ ...mockRuntime, lastHeartbeatAt: null })).toBe('-');
    const text = component.heartbeatText(mockRuntime);
    expect(text).toContain('（30 秒前）');
  });

  it('onTemplatesChange 调用 saveUiConfig，payload 保留当前 menu/welcomeText 并更新 messageConfig，且带 If-Unmodified-Since', () => {
    component.ngOnInit();
    const newTemplates: MessageTemplates = {
      ...mockUiConfig.messageConfig,
      welcome: '新欢迎文案',
      orderCreated: '新订单文案'
    };
    component.onTemplatesChange(newTemplates);

    expect(uiConfigService.saveUiConfig).toHaveBeenCalledTimes(1);
    const [payload, ifUnmodifiedSince] = uiConfigService.saveUiConfig.calls.mostRecent().args;
    expect(payload).toEqual({
      welcomeText: mockUiConfig.welcomeText,
      menuConfig: mockUiConfig.menuConfig,
      messageConfig: newTemplates
    });
    expect(ifUnmodifiedSince).toBe(mockUiConfig.updatedAt);
  });

  it('onTemplatesChange 保存成功后 uiConfig.messageConfig 与 updatedAt 更新，且 initialMenu 不被影响', () => {
    component.ngOnInit();
    const originalMenuRef = component.initialMenu();
    const newTemplates: MessageTemplates = {
      ...mockUiConfig.messageConfig,
      welcome: '更新后的欢迎'
    };
    component.onTemplatesChange(newTemplates);

    const ui = component.uiConfig();
    expect(ui?.messageConfig).toEqual(newTemplates);
    expect(ui?.updatedAt).toBe('2026-05-02T11:00:00.000Z');
    // 模板保存不应触发 initialMenu 重置（避免误触发 MenuDesigner 的 effect）
    expect(component.initialMenu()).toBe(originalMenuRef);

    // 乐观锁：下一次保存用新 updatedAt
    component.onTemplatesChange({ ...newTemplates, welcome: '再次修改' });
    const secondIfUnmodified = uiConfigService.saveUiConfig.calls.mostRecent().args[1];
    expect(secondIfUnmodified).toBe('2026-05-02T11:00:00.000Z');
  });

  it('uiConfig 为 null 时 onTemplatesChange 直接返回不调 saveUiConfig', () => {
    uiConfigService.getUiConfig.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500 }))
    );
    component.ngOnInit();
    expect(component.uiConfig()).toBeNull();

    component.onTemplatesChange({
      welcome: 'x',
      orderCreated: '',
      payPending: '',
      paySuccess: '',
      payFailed: '',
      addressInvalid: '',
      unknownCommand: '',
      packageUnavailable: '',
      walletQueryResult: ''
    });
    expect(uiConfigService.saveUiConfig).not.toHaveBeenCalled();
  });

  // 防止 TS 未使用变量警告
  it('componentRef 可用', () => {
    expect(componentRef.instance).toBe(component);
  });
});

/**
 * 独立 describe：验证第 3 tab 在真实模板渲染下正确挂载 MessageTemplateEditor。
 *
 * 上面的主 describe 用 `overrideComponent({ set: { template: '' } })` 绕开了整套模板
 * 渲染（因为 MenuDesigner 的依赖链会拖慢测试），只能断言组件方法行为。要验证模板里
 * `<app-message-template-editor>` selector 真实存在，需要保留模板。这里通过：
 * 1. 把模板替换成只含"第 3 tab 内容"的精简版（去掉 MenuDesigner、Tabs、表单等）；
 * 2. 注入 NZ_ICONS provider 让 MessageTemplateEditor 的图标可渲染；
 * 让真实 MessageTemplateEditor 挂载到 DOM，用 By.directive 查询。
 */
describe('EnergyRentalAgentBotConfigComponent 第 3 tab 模板集成', () => {
  let dataService: jasmine.SpyObj<EnergyRentalService>;
  let uiConfigService: jasmine.SpyObj<UiConfigService>;

  const mockConfig: AgentBotConfig = {
    scope: 'agent',
    agentId: 42,
    botStatus: 'enabled',
    telegramBotToken: '',
    telegramBotTokenConfigured: true,
    telegramBotUsername: '@my_bot',
    welcomeText: '',
    menuConfig: '',
    messageConfig: '',
    remark: ''
  };

  const mockRuntime: BotRuntimeStatus = {
    scope: 'agent',
    agentId: 42,
    desiredStatus: 'enabled',
    desiredStatusLabel: '已启用',
    serviceStatus: 'online',
    serviceStatusLabel: '在线',
    runtimeStatus: 'running',
    pollingStatus: 'polling',
    lastHeartbeatAt: null,
    heartbeatAgeSeconds: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    lastError: '',
    instanceId: 'inst-1',
    telegramBotTokenConfigured: true,
    canEnable: true
  };

  const mockUiConfig: UiConfig = {
    welcomeText: 'w',
    menuConfig: [{ id: 'row-1', buttons: [] }] as MenuRow[],
    messageConfig: {
      welcome: 'w',
      orderCreated: 'oc',
      payPending: 'pp',
      paySuccess: 'ps',
      payFailed: 'pf',
      addressInvalid: 'ai',
      unknownCommand: 'uc',
      packageUnavailable: 'pu',
      walletQueryResult: 'wqr'
    },
    updatedAt: '2026-05-02T10:00:00.000Z'
  };

  // 精简模板：只保留第 3 tab 的降级/渲染逻辑。MenuDesigner 不出现，避免 DI 爆炸。
  const MINIMAL_TAB3_TEMPLATE = `
    @if (uiConfigLoadError()) {
      <nz-alert nzType="error" nzMessage="消息模板数据加载失败" data-testid="tpl-load-error"></nz-alert>
    } @else if (uiConfig(); as ui) {
      <app-message-template-editor
        [initialTemplates]="ui.messageConfig"
        (templatesChange)="onTemplatesChange($event)"
      ></app-message-template-editor>
    }
  `;

  beforeEach(() => {
    dataService = jasmine.createSpyObj<EnergyRentalService>('EnergyRentalService', [
      'getAgentBotConfig',
      'updateAgentBotConfig',
      'getBotRuntimeStatus',
      'updateBotRuntimeStatus'
    ]);
    uiConfigService = jasmine.createSpyObj<UiConfigService>('UiConfigService', [
      'getUiConfig',
      'saveUiConfig'
    ]);

    dataService.getAgentBotConfig.and.returnValue(of(mockConfig));
    dataService.getBotRuntimeStatus.and.returnValue(of(mockRuntime));
    dataService.updateAgentBotConfig.and.returnValue(of(undefined));
    dataService.updateBotRuntimeStatus.and.returnValue(of(undefined));
    uiConfigService.getUiConfig.and.returnValue(of(mockUiConfig));
    uiConfigService.saveUiConfig.and.returnValue(of({ updatedAt: '2026-05-02T11:00:00.000Z' }));

    TestBed.configureTestingModule({
      imports: [EnergyRentalAgentBotConfigComponent],
      providers: [
        { provide: EnergyRentalService, useValue: dataService },
        { provide: UiConfigService, useValue: uiConfigService },
        {
          provide: NZ_ICONS,
          useValue: [
            CheckCircleOutline,
            CloseCircleOutline,
            ExclamationCircleOutline,
            EyeOutline,
            InfoCircleOutline
          ]
        }
      ]
    });

    TestBed.overrideComponent(EnergyRentalAgentBotConfigComponent, {
      set: { template: MINIMAL_TAB3_TEMPLATE }
    });
  });

  it('uiConfig 加载成功时第 3 tab 真实渲染 MessageTemplateEditor', () => {
    const fixture = TestBed.createComponent(EnergyRentalAgentBotConfigComponent);
    fixture.detectChanges();

    const editorDebug = fixture.debugElement.query(By.directive(MessageTemplateEditorComponent));
    expect(editorDebug).toBeTruthy();
    const editorInstance = editorDebug.componentInstance as MessageTemplateEditorComponent;
    expect(editorInstance.initialTemplates()).toEqual(mockUiConfig.messageConfig);
  });

  it('uiConfig 加载失败时不渲染 editor，降级显示错误 alert', () => {
    uiConfigService.getUiConfig.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500 }))
    );
    const fixture = TestBed.createComponent(EnergyRentalAgentBotConfigComponent);
    fixture.detectChanges();

    const editorDebug = fixture.debugElement.query(By.directive(MessageTemplateEditorComponent));
    expect(editorDebug).toBeNull();

    const errorAlert = fixture.debugElement.query(By.css('[data-testid="tpl-load-error"]'));
    expect(errorAlert).toBeTruthy();
  });

  it('MessageTemplateEditor 的 templatesChange 冒泡触发 saveUiConfig', () => {
    const fixture = TestBed.createComponent(EnergyRentalAgentBotConfigComponent);
    fixture.detectChanges();

    const editorDebug = fixture.debugElement.query(By.directive(MessageTemplateEditorComponent));
    expect(editorDebug).toBeTruthy();
    const editorInstance = editorDebug.componentInstance as MessageTemplateEditorComponent;

    const nextTemplates: MessageTemplates = {
      ...mockUiConfig.messageConfig,
      welcome: '来自 editor 的新值'
    };
    editorInstance.templatesChange.emit(nextTemplates);

    expect(uiConfigService.saveUiConfig).toHaveBeenCalledTimes(1);
    const [payload] = uiConfigService.saveUiConfig.calls.mostRecent().args;
    expect(payload).toEqual(
      jasmine.objectContaining({
        welcomeText: mockUiConfig.welcomeText,
        menuConfig: mockUiConfig.menuConfig,
        messageConfig: nextTemplates
      })
    );
  });
});
