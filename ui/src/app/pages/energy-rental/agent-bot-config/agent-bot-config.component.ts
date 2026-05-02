import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

import { AgentBotConfig, BotRuntimeStatus, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { UiConfig, UiConfigService } from '@services/energy-rental/ui-config.service';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';
import { fnCheckForm } from '@utils/tools';

import type { MenuRow } from './designer/types';
import { MenuDesignerComponent } from './designer/menu-designer/menu-designer.component';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
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
 * - onMenuChange 收到 MenuDesigner 的保存信号后，调 uiConfigService.saveUiConfig，
 *   messageConfig / welcomeText 原样回传当前 uiConfig 快照（PR4 任务 23 再补模板编辑 UI）。
 *   保存成功后更新 uiConfig.updatedAt，否则下次保存会 409。
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
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzDescriptionsModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
    NzRadioModule,
    NzSelectModule,
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
  readonly toggling = signal(false);

  // Bot 基础层状态
  readonly config = signal<AgentBotConfig | null>(null);
  readonly runtime = signal<BotRuntimeStatus | null>(null);

  // UiConfig 层（Designer 数据）
  readonly uiConfig = signal<UiConfig | null>(null);
  /** 传入 MenuDesignerComponent 的初始菜单；显式分离是为了让 effect 重跑时能拿到稳定引用 */
  readonly initialMenu = signal<MenuRow[]>([]);
  /** getUiConfig 是否加载失败，用于菜单设计 tab 的降级 UI */
  readonly uiConfigLoadError = signal(false);

  readonly botStatusOptions = [
    { label: '启用', value: 'enabled' },
    { label: '停用', value: 'disabled' }
  ];

  readonly form = inject(FormBuilder).nonNullable.group({
    botStatus: ['disabled', [Validators.required]],
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
        this.form.patchValue({
          botStatus: config.botStatus || 'disabled',
          telegramBotToken: '',
          telegramBotUsername: config.telegramBotUsername || '',
          remark: config.remark || ''
        });
      });
  }

  /**
   * 保存 bot 基础层字段（token / status / username / remark）。
   *
   * 故意不传 menuConfig / messageConfig / welcomeText——这些属于 UiConfigService 的管辖范围，
   * 由 onMenuChange 单独保存，避免同一请求里两个端点的数据字段交叉污染。
   */
  onSaveBot(): void {
    if (!fnCheckForm(this.form)) {
      return;
    }
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.dataService
      .updateAgentBotConfig({
        botStatus: raw.botStatus,
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

  toggleRuntime(botStatus: 'enabled' | 'disabled'): void {
    this.toggling.set(true);
    this.dataService
      .updateBotRuntimeStatus({ botStatus })
      .pipe(
        finalize(() => this.toggling.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.form.controls.botStatus.setValue(botStatus);
        this.loadAll();
      });
  }

  /**
   * MenuDesignerComponent 保存菜单时触发。
   *
   * - messageConfig / welcomeText 原样回传：PR4 任务 23 才会加模板编辑 UI，
   *   此刻不回传会被 DTO 视为"未提供"——而后端 UiConfigDto 三字段可选，
   *   未提供就保留原值，但为了契约清晰仍显式回传。
   * - 乐观锁：ifUnmodifiedSince 传当前 uiConfig.updatedAt；
   *   成功后 update uiConfig.updatedAt，否则下次保存会 409。
   */
  onMenuChange(menu: MenuRow[]): void {
    const ui = this.uiConfig();
    if (!ui) {
      return;
    }
    this.saving.set(true);
    this.uiConfigService
      .saveUiConfig(
        {
          welcomeText: ui.welcomeText,
          menuConfig: menu,
          messageConfig: ui.messageConfig
        },
        ui.updatedAt
      )
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(result => {
        this.uiConfig.update(prev =>
          prev ? { ...prev, menuConfig: menu, updatedAt: result.updatedAt } : prev
        );
        this.initialMenu.set(menu);
      });
  }
}
