import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { AgentBotConfig, BotRuntimeStatus, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';
import { fnCheckForm } from '@utils/tools';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';

@Component({
  selector: 'app-energy-rental-agent-bot-config',
  templateUrl: './agent-bot-config.component.html',
  styleUrl: './agent-bot-config.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    ReactiveFormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzDescriptionsModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
    NzSelectModule,
    NzSpinModule,
    NzTagModule
  ]
})
export class EnergyRentalAgentBotConfigComponent implements OnInit {
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '机器人配置',
    breadcrumb: ['首页', '机器人控制', '机器人配置'],
    desc: '配置当前账号的 Telegram 机器人。'
  };
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly toggling = signal(false);
  readonly config = signal<AgentBotConfig | null>(null);
  readonly runtime = signal<BotRuntimeStatus | null>(null);
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
  private destroyRef = inject(DestroyRef);

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

  loadConfig(): void {
    this.loading.set(true);
    forkJoin({
      config: this.dataService.getAgentBotConfig(),
      runtime: this.dataService.getBotRuntimeStatus()
    })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ config: data, runtime }) => {
        this.config.set(data);
        this.runtime.set(runtime);
        this.form.patchValue({
          botStatus: data.botStatus || 'disabled',
          telegramBotToken: '',
          telegramBotUsername: data.telegramBotUsername || '',
          remark: data.remark || ''
        });
      });
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
        this.loadConfig();
      });
  }

  submit(): void {
    if (!fnCheckForm(this.form)) {
      return;
    }
    this.saving.set(true);
    this.dataService
      .updateAgentBotConfig(this.form.getRawValue())
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.loadConfig());
  }

  ngOnInit(): void {
    this.loadConfig();
  }
}
