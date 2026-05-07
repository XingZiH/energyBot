import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

import { AgentBotConfig, BotRuntimeStatus, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { UiConfig, UiConfigService } from '@services/energy-rental/ui-config.service';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';
import { fnCheckForm } from '@utils/tools';

import type { MenuRow, MessageTemplates } from './designer/types';
import { DesignerChange, MenuDesignerComponent } from './designer/menu-designer/menu-designer.component';
import { MessageTemplateEditorComponent } from './designer/message-template-editor/message-template-editor.component';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTagModule } from 'ng-zorro-antd/tag';

/**
 * 机器人配置页面（v2 顶层容器）。
 *
 * ## 架构
 *
 * 本组件是 Designer v2 的父容器，职责：
 * 1. Bot 基础层（token / 启停 / username / remark）仍走旧 `/agent-bot-config`（EnergyRentalService）
 * 2. 菜单 / 消息模板 / welcomeText 走新 `/ui-config`（UiConfigService，强类型 + 乐观锁）
 * 3. 挂载 MenuDesignerComponent 子组件，监听其 menuChange 事件完成菜单保存
 *
 * ## 数据流
 *
 * - ngOnInit 并发拉取 3 个端点（getAgentBotConfig / getBotRuntimeStatus / getUiConfig），
 *   其中 getUiConfig 失败不阻塞其他两项（catchError 吞错 + uiConfig 置 null 降级）。
 * - onSaveBot 只提交 bot 层字段，不传 menuConfig / messageConfig（这两个字段由 UiConfigService 管理，
 *   避免新旧双写导致数据冲突）。
 * - onMenuChange / onTemplatesChange 共享 saveUiConfigPatch helper，合并当前 uiConfig 快照与
 *   局部补丁后整体 PUT，保存成功后同步更新 uiConfig.updatedAt（乐观锁基线）。
 */
@Component({
  selector: 'app-energy-rental-agent-bot-config',
  standalone: true,
  templateUrl: './agent-bot-config.component.html',
  styleUrl: './agent-bot-config.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    FormsModule,
    ReactiveFormsModule,
    MenuDesignerComponent,
    MessageTemplateEditorComponent,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzDescriptionsModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
    NzRadioModule,
    NzSpinModule,
    NzSwitchModule,
    NzTabsModule,
    NzTagModule
  ]
})
export class EnergyRentalAgentBotConfigComponent implements OnInit {
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '机器人配置',
    breadcrumb: ['首页', '机器人控制', '机器人配置'],
    desc: '配置当前账号的 Telegram 机器人、回复文案与按钮编排。'
  };

  readonly loading = signal(false);
  readonly saving = signal(false);

  // Bot 基础层状态
  readonly config = signal<AgentBotConfig | null>(null);
  readonly runtime = signal<BotRuntimeStatus | null>(null);

  // UiConfig 层（Designer 数据）
  readonly uiConfig = signal<UiConfig | null>(null);
  /** 传入 MenuDesignerComponent 的初始菜单；显式分离是为了让 effect 重跑时能拿到稳定引用 */
  readonly initialMenu = signal<MenuRow[]>([]);
  /** 传入 MenuDesignerComponent 的初始 welcomeText（同样独立 signal，便于父组件 patch 后同步） */
  readonly initialWelcomeText = signal<string>('');
  /** 传入 MenuDesignerComponent 的初始 packageGroupText */
  readonly initialPackageGroupText = signal<string>('');
  /** getUiConfig 是否加载失败，用于菜单设计 tab 的降级 UI */
  readonly uiConfigLoadError = signal(false);

  readonly form = inject(FormBuilder).nonNullable.group({
    telegramBotToken: [''],
    telegramBotUsername: [''],
    remark: ['']
  });

  private dataService = inject(EnergyRentalService);
  private uiConfigService = inject(UiConfigService);
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.loadAll();
  }

  statusText(value: boolean | undefined): string {
    return value ? '已配置' : '未配置';
  }

  statusColor(value: boolean | undefined): string {
    return value ? 'green' : 'red';
  }

  runtimeStatusText(value: string | undefined): string {
    const statusMap: Record<string, string> = {
      running: '运行中',
      stopped: '已停用',
      error: '异常',
      unknown: '未知'
    };
    return statusMap[value || ''] || '未知';
  }

  pollingStatusText(value: string | undefined): string {
    const statusMap: Record<string, string> = {
      polling: '轮询中',
      stopped: '未轮询',
      error: '异常',
      unknown: '未知'
    };
    return statusMap[value || ''] || '未知';
  }

  runtimeStatusColor(value: string | undefined): string {
    if (value === 'running' || value === 'polling') {
      return 'green';
    }
    if (value === 'error') {
      return 'red';
    }
    if (value === 'stopped') {
      return 'default';
    }
    return 'orange';
  }

  serviceStatusColor(value: string | undefined): string {
    return value === 'online' ? 'green' : 'red';
  }

  botScopeLabel(): string {
    return this.config()?.scope === 'platform' ? '平台机器人' : '用户机器人';
  }

  formatRuntimeTime(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  heartbeatText(runtime: BotRuntimeStatus | null): string {
    if (!runtime?.lastHeartbeatAt) {
      return '-';
    }
    const age = runtime.heartbeatAgeSeconds;
    return `${this.formatRuntimeTime(runtime.lastHeartbeatAt)}${typeof age === 'number' ? `（${age} 秒前）` : ''}`;
  }

  /**
   * 并发加载 3 个端点。
   *
   * getUiConfig 失败时返回 null 占位——菜单 tab 显示错误提示，但不阻塞基础设置 tab。
   * 若阻塞整个页面会导致用户连 bot token 都无法配置，体验更差。
   */
  loadAll(): void {
    this.loading.set(true);
    this.uiConfigLoadError.set(false);
    forkJoin({
      config: this.dataService.getAgentBotConfig(),
      runtime: this.dataService.getBotRuntimeStatus(),
      ui: this.uiConfigService.getUiConfig().pipe(
        catchError(() => {
          this.uiConfigLoadError.set(true);
          return of(null);
        })
      )
    })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ config, runtime, ui }) => {
        this.config.set(config);
        this.runtime.set(runtime);
        this.uiConfig.set(ui);
        this.initialMenu.set(ui?.menuConfig ?? []);
        this.initialWelcomeText.set(ui?.welcomeText ?? '');
        this.initialPackageGroupText.set(ui?.packageGroupText ?? '');
        this.form.patchValue({
          telegramBotToken: '',
          telegramBotUsername: config.telegramBotUsername || '',
          remark: config.remark || ''
        });
      });
  }

  /**
   * 保存 bot 基础层字段（token / username / remark）。
   *
   * 故意不传 menuConfig / messageConfig / welcomeText——这些属于 UiConfigService 的管辖范围，
   * 由 onMenuChange 单独保存，避免同一请求里两个端点的数据字段交叉污染。
   *
   * 不再传 botStatus：bot 启停统一由「我的 Bot」页面的 start/stop 触发，
   * 后端 bot_status 字段仅作为 agent 期望状态记录，不在本页编辑。
   */
  onSaveBot(): void {
    if (!fnCheckForm(this.form)) {
      return;
    }
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.dataService
      .updateAgentBotConfig({
        telegramBotToken: raw.telegramBotToken,
        telegramBotUsername: raw.telegramBotUsername,
        remark: raw.remark
      })
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.loadAll());
  }

  /**
   * 通用的 UiConfig 局部保存 helper。
   *
   * MenuDesigner / MessageTemplateEditor 各自只关心自己那一块字段，但后端 PUT /ui-config
   * 端点用的是同一个 UiConfigDto（三字段全可选、未提供保留原值）。这里用 patch 合并策略：
   * - patch 里给出的字段取新值；未给出的回退到当前 uiConfig 快照。
   * - 乐观锁：传当前 uiConfig.updatedAt；成功后更新 updatedAt 到最新快照，
   *   否则下一次保存会 412（If-Unmodified-Since 不匹配）。
   * - 如果本次 patch 包含 menuConfig，同步更新 `initialMenu` signal——
   *   MenuDesigner 子组件依赖这个 signal 做稳定引用，重置 dirty 状态。
   *
   * uiConfig 为 null 时直接 return：ui-config 加载失败的降级路径下，
   * 既没有乐观锁基线也没有其他字段快照，贸然 PUT 会覆盖线上数据。
   */
  private saveUiConfigPatch(patch: {
    menuConfig?: MenuRow[];
    messageConfig?: MessageTemplates;
    welcomeText?: string;
    packageGroupText?: string;
  }): void {
    const ui = this.uiConfig();
    if (!ui) {
      return;
    }
    const payload: Record<string, unknown> = {
      welcomeText: patch.welcomeText ?? ui.welcomeText,
      packageGroupText: patch.packageGroupText ?? ui.packageGroupText,
      menuConfig: patch.menuConfig ?? ui.menuConfig,
    };
    // 只有调用方显式传入 messageConfig 时才携带——
    // 保存菜单时不传此字段，后端 @IsOptional() 会跳过验证并保留 DB 原值。
    // 之前的 bug：fallback 到 ui.messageConfig（可能是 DB 中的空对象 {}，
    // 所有字段为 undefined）导致 @ValidateNested 对 9 个字段全部报错。
    if (patch.messageConfig) {
      payload['messageConfig'] = patch.messageConfig;
    }
    this.saving.set(true);
    this.uiConfigService
      .saveUiConfig(payload, ui.updatedAt)
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(result => {
        this.uiConfig.update(prev => (prev ? { ...prev, ...patch, updatedAt: result.updatedAt } : prev));
        if (patch.menuConfig) {
          this.initialMenu.set(patch.menuConfig);
        }
        if (patch.welcomeText !== undefined) {
          this.initialWelcomeText.set(patch.welcomeText);
        }
        if (patch.packageGroupText !== undefined) {
          this.initialPackageGroupText.set(patch.packageGroupText);
        }
      });
  }

  /**
   * MenuDesignerComponent 保存时触发（v2）。
   *
   * v2 把 welcomeText 和 menuConfig 合并到同一次 emit：
   * - 用户"保存菜单"按钮一次写入两个字段
   * - 共享乐观锁版本：一次 If-Unmodified-Since 不会出现半提交
   */
  onDesignerChange(change: DesignerChange): void {
    this.saveUiConfigPatch({
      welcomeText: change.welcomeText,
      menuConfig: change.menuConfig,
      packageGroupText: change.packageGroupText,
    });
  }

  /**
   * MessageTemplateEditorComponent 保存模板时触发（任务 26）。
   *
   * 和 onMenuChange 共享同一个 UiConfigService.saveUiConfig 端点与乐观锁机制：
   * menuConfig / welcomeText 原样回传，避免覆盖当前菜单。
   */
  onTemplatesChange(templates: MessageTemplates): void {
    this.saveUiConfigPatch({ messageConfig: templates });
  }
}
