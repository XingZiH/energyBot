import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';

import {
  MyBotAgentView,
  MyBotService,
} from '@services/account/my-bot.service';
import { PageHeaderType, PageHeaderComponent } from '@shared/components/page-header/page-header.component';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSpaceModule } from 'ng-zorro-antd/space';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzStatisticModule } from 'ng-zorro-antd/statistic';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTypographyModule } from 'ng-zorro-antd/typography';

/**
 * 终端客户自助「我的 Bot」页面。
 *
 * 交互：
 * - 进入页面即 findMine()；后端返回 MyBotAgentView[]
 *   - 空数组 → nz-empty 引导前往「我的 License」
 *   - 1 个 agent → nz-descriptions 铺开展示
 *   - 多个 agent → nz-table + expanded row 展示详细指标
 * - 无 reveal 按钮、无刷新按钮（任务 18 只做首屏展示）
 *
 * 权限兜底：
 * - 路由菜单 code = default:account:my-bot，由后端按 role 下发
 * - 管理员账号若未绑定客户，后端返回 404，页面展示"当前账号暂无 Bot"
 */
@Component({
  selector: 'app-my-bot',
  templateUrl: './my-bot.component.html',
  styleUrl: './my-bot.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    PageHeaderComponent,
    NzAlertModule,
    NzCardModule,
    NzDescriptionsModule,
    NzDividerModule,
    NzEmptyModule,
    NzIconModule,
    NzProgressModule,
    NzSpaceModule,
    NzSpinModule,
    NzStatisticModule,
    NzTableModule,
    NzTagModule,
    NzTypographyModule,
  ],
})
export class MyBotComponent implements OnInit {
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '我的 Bot',
    breadcrumb: ['首页', '我的 Bot'],
    desc: '查看自己客户下所有 agent 主机的连接状态与运行指标。',
  };

  readonly loading = signal(false);
  readonly agents = signal<MyBotAgentView[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly expandedIds = signal<Set<number>>(new Set());

  private destroyRef = inject(DestroyRef);
  private dataService = inject(MyBotService);
  private message = inject(NzMessageService);

  ngOnInit(): void {
    this.loadAgents();
  }

  loadAgents(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.dataService
      .findMine()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: list => this.agents.set(list ?? []),
        error: err => {
          // 后端 404（未绑定客户）在本页属于"空状态"，不是 toast 报错
          const msg = err?.error?.msg || err?.message || '加载失败';
          this.errorMessage.set(msg);
        },
      });
  }

  /**
   * status → nz-tag 颜色映射。
   */
  statusColor(status: string): string {
    switch (status) {
      case 'online':
        return 'green';
      case 'offline':
        return 'red';
      case 'never_seen':
      default:
        return 'default';
    }
  }

  /**
   * status → 中文标签。
   */
  statusLabel(status: string): string {
    switch (status) {
      case 'online':
        return '在线';
      case 'offline':
        return '离线';
      case 'never_seen':
        return '从未上线';
      default:
        return status;
    }
  }

  /**
   * 秒数转 "X 天 Y 小时 Z 分钟" 可读格式。null 返回 '—'。
   */
  formatUptime(seconds: number | null): string {
    if (seconds == null) {
      return '—';
    }
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d} 天 ${h} 小时`;
    if (h > 0) return `${h} 小时 ${m} 分钟`;
    return `${m} 分钟`;
  }

  /**
   * bytes 转 GB（1 位小数），null 返回 '—'。
   */
  bytesToGb(bytes: number | null): string {
    if (bytes == null) return '—';
    return (bytes / 1024 / 1024 / 1024).toFixed(2);
  }

  /**
   * 内存使用率百分比，用于 nz-progress。mem 信息缺失时返回 0。
   */
  memPercent(used: number | null, total: number | null): number {
    if (!used || !total || total === 0) return 0;
    return Math.round((used / total) * 100);
  }

  /**
   * cpuPercent string → number，用于 nz-progress。
   */
  cpuPercentNumber(cpu: string | null): number {
    if (!cpu) return 0;
    const n = parseFloat(cpu);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }

  isExpanded(id: number): boolean {
    return this.expandedIds().has(id);
  }

  toggleExpand(id: number, expanded: boolean): void {
    const next = new Set(this.expandedIds());
    if (expanded) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.expandedIds.set(next);
  }
}
