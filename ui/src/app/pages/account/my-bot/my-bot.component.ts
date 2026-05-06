import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, finalize, switchMap, takeWhile } from 'rxjs/operators';
import { EMPTY, Subscription, of, timer } from 'rxjs';

import {
  MyBotAgentView,
  MyBotService,
} from '@services/account/my-bot.service';
import { PageHeaderType, PageHeaderComponent } from '@shared/components/page-header/page-header.component';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSpaceModule } from 'ng-zorro-antd/space';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzStatisticModule } from 'ng-zorro-antd/statistic';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
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
    NzButtonModule,
    NzCardModule,
    NzDescriptionsModule,
    NzDividerModule,
    NzEmptyModule,
    NzIconModule,
    NzPopconfirmModule,
    NzProgressModule,
    NzSpaceModule,
    NzSpinModule,
    NzStatisticModule,
    NzTableModule,
    NzTagModule,
    NzTooltipModule,
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

  /**
   * 正在下发 action 的 licenseId 集合。用于禁用按钮防重复点击。
   * 不用 loading 整体标志：同一页多 agent 时要允许并行操作不同 license。
   *
   * 一次 action 的完整生命周期：
   * 1. 点击 → 加入 actionInFlight，UI 按钮 loading + 本地乐观更新 botStatus
   * 2. POST /my-bot/:licenseId/start 下发
   * 3. 从 +2s 开始每 2s 轮询 findMine()，直到：
   *    - botStatus 进入稳定态（running / stopped / error）
   *    - 或 20s 超时
   * 4. 轮询结束 → 从 actionInFlight 移除，按钮恢复可点
   *
   * 期间用户点其他按钮（停止/重载）或切走页面：trackedPolls 会被取消。
   */
  readonly actionInFlight = signal<Set<number>>(new Set());

  /** 每个 licenseId 对应正在跑的 poll 订阅，用于在新 action 到来时取消老轮询 */
  private trackedPolls = new Map<number, Subscription>();

  private destroyRef = inject(DestroyRef);
  private dataService = inject(MyBotService);

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

  // ================= B3-T5 bot 生命周期操作 =================

  /**
   * bot 运行态 → nz-tag 颜色。
   * 与 agent 的 status 独立展示——agent 可能 online 但 bot stopped（未启动）。
   */
  botStatusColor(botStatus: string | null): string {
    switch (botStatus) {
      case 'running':
        return 'green';
      case 'starting':
        return 'blue';
      case 'stopped':
        return 'default';
      case 'error':
        return 'red';
      case 'unknown':
      default:
        return 'default';
    }
  }

  botStatusLabel(botStatus: string | null): string {
    switch (botStatus) {
      case 'running':
        return '运行中';
      case 'starting':
        return '启动中';
      case 'stopped':
        return '已停止';
      case 'error':
        return '错误';
      case 'unknown':
        return '未知';
      case null:
      case undefined:
      default:
        return '未启用'; // 旧版 agent 或未挂 supervisor
    }
  }

  /**
   * 启动按钮可点：agent 在线 + bot 为 stopped/error/unknown。
   * running/starting 时禁用避免重复启动。botStatus===null 也允许点击——
   * 给客户一个「试一次」的机会，若 agent 不支持后端会 503（dispatcher 未注册）。
   */
  canStart(a: MyBotAgentView): boolean {
    if (a.status !== 'online') return false;
    if (this.actionInFlight().has(a.licenseId)) return false;
    return a.botStatus !== 'running' && a.botStatus !== 'starting';
  }

  /**
   * 停止按钮可点：agent 在线 + bot 处于 running/starting/error。
   * stopped/unknown/null 时无意义。
   */
  canStop(a: MyBotAgentView): boolean {
    if (a.status !== 'online') return false;
    if (this.actionInFlight().has(a.licenseId)) return false;
    return a.botStatus === 'running' || a.botStatus === 'starting' || a.botStatus === 'error';
  }

  /**
   * 重载按钮可点：agent 在线 + bot 运行中。
   * 非 running 时走「启动」而非「重载」，避免语义混淆。
   */
  canReload(a: MyBotAgentView): boolean {
    if (a.status !== 'online') return false;
    if (this.actionInFlight().has(a.licenseId)) return false;
    return a.botStatus === 'running';
  }

  isActionInFlight(licenseId: number): boolean {
    return this.actionInFlight().has(licenseId);
  }

  startBot(a: MyBotAgentView): void {
    this.dispatchAction({
      licenseId: a.licenseId,
      obs: this.dataService.startBot(a.licenseId),
      optimisticStatus: 'starting',
      terminalStatuses: ['running', 'error'],
    });
  }

  stopBot(a: MyBotAgentView): void {
    this.dispatchAction({
      licenseId: a.licenseId,
      obs: this.dataService.stopBot(a.licenseId),
      // bot 端没有 'stopping' 中间态；直接乐观置 stopped 让 UI 立刻反馈
      optimisticStatus: 'stopped',
      terminalStatuses: ['stopped', 'error'],
    });
  }

  reloadBot(a: MyBotAgentView): void {
    this.dispatchAction({
      licenseId: a.licenseId,
      obs: this.dataService.reloadBot(a.licenseId),
      // 重载流程：先 stopping → starting → running。乐观先置 starting 让用户看到"动了"
      optimisticStatus: 'starting',
      terminalStatuses: ['running', 'error'],
    });
  }

  /**
   * 统一下发路径：
   *
   * 1. 取消该 license 的旧轮询（若有）
   * 2. 标记 actionInFlight + 乐观更新本地 botStatus → UI 立刻进入「启动中/已停止」反馈
   * 3. POST 下发 action
   * 4. +2s 起每 2s 轮询 findMine()，最多 10 次（合计 22s 窗口）
   *    - 命中 terminalStatuses（running / stopped / error）→ 立即停止轮询
   *    - 超时仍未稳定 → 停止轮询（可能 agent 离线，状态保持当前最新值）
   * 5. 轮询结束 → 移除 actionInFlight + 清理 trackedPolls
   *
   * 为什么不直接乐观置终态：bot.start 的真实路径是 stopped → starting → running，
   * 中间可能因 token 错误停在 error。直接置 running 会误导用户；置 starting
   * 既给即时反馈又不假装最终成功。
   */
  private dispatchAction(opts: {
    licenseId: number;
    obs: ReturnType<MyBotService['startBot']>;
    optimisticStatus: 'starting' | 'stopped';
    terminalStatuses: Array<'running' | 'stopped' | 'error'>;
  }): void {
    const { licenseId, obs, optimisticStatus, terminalStatuses } = opts;

    // 1. 取消可能的旧轮询（用户连点多个按钮）
    this.trackedPolls.get(licenseId)?.unsubscribe();
    this.trackedPolls.delete(licenseId);

    // 2. 乐观更新 + 标记 in-flight
    const mark = new Set(this.actionInFlight());
    mark.add(licenseId);
    this.actionInFlight.set(mark);
    this.applyOptimisticBotStatus(licenseId, optimisticStatus);

    // 3. 下发请求
    obs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // 4. 开始轮询直到状态稳定或超时
          const poll$ = timer(2000, 2000).pipe(
            // 最多 11 个 tick = ~22s（覆盖最长一次 30s 心跳间隔下的两次心跳）
            takeWhile((_, idx) => idx < 11),
            switchMap(() =>
              this.dataService.findMine().pipe(
                catchError(() => of(null)), // 单次拉取失败不中断轮询
              ),
            ),
            takeWhile(list => {
              if (!list) return true; // 拉取失败：继续等
              const found = list.find(x => x.licenseId === licenseId);
              // 状态进入终态 → 此 tick 接收最新数据后即停（inclusive=true）
              const isTerminal =
                !!found && terminalStatuses.includes(found.botStatus as 'running' | 'stopped' | 'error');
              return !isTerminal;
            }, true),
          );

          const sub = poll$
            .pipe(
              finalize(() => this.releaseInFlight(licenseId)),
              takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
              next: list => {
                if (list) {
                  this.agents.set(list);
                }
              },
              error: () => { /* 忽略：finalize 兜底 */ },
            });

          this.trackedPolls.set(licenseId, sub);
        },
        error: () => {
          // BaseHttpService 已经 toast 错误（如 503 agent 离线、403 权限不足）
          // 回滚乐观状态：拉一次最新数据覆盖
          this.releaseInFlight(licenseId);
          this.dataService
            .findMine()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: list => this.agents.set(list ?? []),
              error: () => EMPTY,
            });
        },
      });
  }

  /**
   * 乐观更新本地 botStatus，让按钮 + tag 立即反映"已下发"状态。
   * 真实状态以下一次 findMine() 心跳数据为准会覆盖此处的乐观值。
   */
  private applyOptimisticBotStatus(licenseId: number, status: 'starting' | 'stopped'): void {
    this.agents.update(list =>
      list.map(a =>
        a.licenseId === licenseId
          ? {
              ...a,
              botStatus: status,
              // 乐观置空 lastError，避免上次的红字残留误导
              botLastError: status === 'starting' ? '' : a.botLastError,
            }
          : a,
      ),
    );
  }

  private releaseInFlight(licenseId: number): void {
    const next = new Set(this.actionInFlight());
    next.delete(licenseId);
    this.actionInFlight.set(next);
    this.trackedPolls.delete(licenseId);
  }
}
