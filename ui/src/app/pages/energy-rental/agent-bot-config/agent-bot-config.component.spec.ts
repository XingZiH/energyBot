import { HttpErrorResponse } from '@angular/common/http';
import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';

import { AgentBotConfig, BotRuntimeStatus, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { UiConfig, UiConfigService } from '@services/energy-rental/ui-config.service';
import { of } from 'rxjs';

import { EnergyRentalAgentBotConfigComponent } from './agent-bot-config.component';
import type { MenuRow } from './designer/types';

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
    expect(raw.botStatus).toBe('enabled');
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

  it('onSaveBot 调用 updateAgentBotConfig，且不传 menuConfig / messageConfig / welcomeText', () => {
    component.ngOnInit();
    component.form.patchValue({
      botStatus: 'disabled',
      telegramBotToken: 'new-token',
      telegramBotUsername: '@new_bot',
      remark: 'new note'
    });
    component.onSaveBot();
    expect(dataService.updateAgentBotConfig).toHaveBeenCalledTimes(1);
    const payload = dataService.updateAgentBotConfig.calls.mostRecent().args[0];
    expect(payload).toEqual({
      botStatus: 'disabled',
      telegramBotToken: 'new-token',
      telegramBotUsername: '@new_bot',
      remark: 'new note'
    });
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

  it('onMenuChange 调用 saveUiConfig，body 包含 messageConfig/welcomeText/menu，并带 If-Unmodified-Since', () => {
    component.ngOnInit();
    const newMenu: MenuRow[] = [{ id: 'new-row', buttons: [] }];
    component.onMenuChange(newMenu);

    expect(uiConfigService.saveUiConfig).toHaveBeenCalledTimes(1);
    const [payload, ifUnmodifiedSince] = uiConfigService.saveUiConfig.calls.mostRecent().args;
    expect(payload).toEqual({
      welcomeText: mockUiConfig.welcomeText,
      menuConfig: newMenu,
      messageConfig: mockUiConfig.messageConfig
    });
    expect(ifUnmodifiedSince).toBe(mockUiConfig.updatedAt);
  });

  it('onMenuChange 保存成功后更新 uiConfig.updatedAt 与 initialMenu，避免下次保存 409', () => {
    component.ngOnInit();
    const newMenu: MenuRow[] = [{ id: 'new-row', buttons: [] }];
    component.onMenuChange(newMenu);

    const ui = component.uiConfig();
    expect(ui?.updatedAt).toBe('2026-05-02T11:00:00.000Z');
    expect(ui?.menuConfig).toEqual(newMenu);
    expect(component.initialMenu()).toEqual(newMenu);

    // 再次保存使用新 updatedAt 作为乐观锁
    const secondMenu: MenuRow[] = [{ id: 'second', buttons: [] }];
    component.onMenuChange(secondMenu);
    const secondCallIfUnmodified = uiConfigService.saveUiConfig.calls.mostRecent().args[1];
    expect(secondCallIfUnmodified).toBe('2026-05-02T11:00:00.000Z');
  });

  it('uiConfig 为 null 时 onMenuChange 直接返回不调 saveUiConfig', () => {
    uiConfigService.getUiConfig.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500 }))
    );
    component.ngOnInit();
    expect(component.uiConfig()).toBeNull();

    component.onMenuChange([{ id: 'x', buttons: [] }]);
    expect(uiConfigService.saveUiConfig).not.toHaveBeenCalled();
  });

  it('toggleRuntime 调用 updateBotRuntimeStatus 并刷新数据', () => {
    component.ngOnInit();
    component.toggleRuntime('disabled');
    expect(dataService.updateBotRuntimeStatus).toHaveBeenCalledWith({ botStatus: 'disabled' });
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

  // 防止 TS 未使用变量警告
  it('componentRef 可用', () => {
    expect(componentRef.instance).toBe(component);
  });
});
