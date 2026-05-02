import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { AgentBotConfig, BotRuntimeStatus, EnergyRentalPackage, EnergyRentalService } from '@services/energy-rental/energy-rental.service';
import { PageHeaderComponent, PageHeaderType } from '@shared/components/page-header/page-header.component';
import { fnCheckForm } from '@utils/tools';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTagModule } from 'ng-zorro-antd/tag';

type ButtonAction = 'package' | 'address' | 'wallet' | 'text' | 'url' | 'start' | 'refresh';
type SelectionType = 'row' | 'button' | null;

interface ButtonStyle {
  bgColor?: string;
  textColor?: string;
  bold?: boolean;
  emoji?: string;
  emojiSuffix?: string;
}

interface MenuButton {
  id: string;
  text: string;
  action: ButtonAction;
  packageId?: number | null;
  url?: string;
  message?: string;
  command?: string;
  style: ButtonStyle;
}

interface MenuRow {
  id: string;
  buttons: MenuButton[];
  style: { gap?: number };
}

interface DesignerSelection {
  type: SelectionType;
  rowId: string | null;
  buttonId: string | null;
}

interface ColorPreset {
  name: string;
  bgColor: string;
  textColor: string;
}

const ACTION_LABELS: Record<ButtonAction, string> = {
  package: '购买套餐',
  address: '地址管理',
  wallet: '钱包查询',
  text: '提示文案',
  url: '外部链接',
  start: '返回首页',
  refresh: '刷新套餐'
};

const BUTTON_PRESETS: Array<{ action: ButtonAction; label: string; description: string; icon: string }> = [
  { action: 'package', label: '购买套餐', description: '进入指定套餐下单流程', icon: 'shopping-cart' },
  { action: 'address', label: '地址管理', description: '管理接收能量地址', icon: 'environment' },
  { action: 'wallet', label: '钱包查询', description: '查询钱包链上资源', icon: 'search' },
  { action: 'text', label: '提示文案', description: '回复一段自定义文本', icon: 'message' },
  { action: 'url', label: '外部链接', description: '展示需要打开的链接', icon: 'link' },
  { action: 'start', label: '返回首页', description: '重新打开主菜单', icon: 'home' },
  { action: 'refresh', label: '刷新套餐', description: '刷新套餐列表', icon: 'reload' }
];

const COLOR_PRESETS: ColorPreset[] = [
  { name: '默认', bgColor: '#eef6ff', textColor: '#1677ff' },
  { name: '绿色', bgColor: '#edf9f0', textColor: '#2f9e44' },
  { name: '琥珀', bgColor: '#fff7e6', textColor: '#d48806' },
  { name: '玫红', bgColor: '#fff0f6', textColor: '#c41d7f' },
  { name: '石墨', bgColor: '#f5f5f5', textColor: '#434343' },
  { name: '警告', bgColor: '#fff1f0', textColor: '#cf1322' }
];

const EMOJI_OPTIONS = ['', '⚡', '💎', '🔥', '✅', '📍', '🔎', '💳', '🔔', '⭐', '🚀', '🎁'];

@Component({
  selector: 'app-energy-rental-agent-bot-config',
  templateUrl: './agent-bot-config.component.html',
  styleUrl: './agent-bot-config.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    FormsModule,
    ReactiveFormsModule,
    DragDropModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzDescriptionsModule,
    NzDividerModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
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
  readonly interactiveMode = signal(false);
  readonly config = signal<AgentBotConfig | null>(null);
  readonly runtime = signal<BotRuntimeStatus | null>(null);
  readonly packages = signal<EnergyRentalPackage[]>([]);
  readonly menuRows = signal<MenuRow[]>([]);
  readonly selection = signal<DesignerSelection>({ type: null, rowId: null, buttonId: null });
  readonly selectedRow = computed(() => {
    const rowId = this.selection().rowId;
    return rowId ? (this.menuRows().find(row => row.id === rowId) ?? null) : null;
  });
  readonly selectedButton = computed(() => {
    const row = this.selectedRow();
    const buttonId = this.selection().buttonId;
    return row && buttonId ? (row.buttons.find(button => button.id === buttonId) ?? null) : null;
  });
  readonly buttonDropListIds = computed(() => this.menuRows().map(row => this.buttonDropId(row)));
  readonly actionLabels = ACTION_LABELS;
  readonly buttonPresets = BUTTON_PRESETS;
  readonly colorPresets = COLOR_PRESETS;
  readonly emojiOptions = EMOJI_OPTIONS;
  readonly botStatusOptions = [
    { label: '启用', value: 'enabled' },
    { label: '停用', value: 'disabled' }
  ];
  readonly form = inject(FormBuilder).nonNullable.group({
    botStatus: ['disabled', [Validators.required]],
    telegramBotToken: [''],
    telegramBotUsername: [''],
    welcomeText: [''],
    orderCreated: [''],
    payPending: [''],
    paySuccess: [''],
    payFailed: [''],
    noPackage: [''],
    unknownCommand: [''],
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

  buttonDropId(row: MenuRow): string {
    return `bot-menu-row-${row.id}`;
  }

  rowIndex(row: MenuRow | null): number {
    if (!row) {
      return -1;
    }
    return this.menuRows().findIndex(item => item.id === row.id);
  }

  packageLabel(packageId: number | null | undefined): string {
    const hit = this.packages().find(item => Number(item.id) === Number(packageId));
    return hit?.packageName || (packageId ? `套餐 #${packageId}` : '未选择套餐');
  }

  defaultButtonText(button: MenuButton, rowIndex = 0): string {
    if (button.action === 'package' && button.packageId) {
      return this.packageLabel(button.packageId);
    }
    const labels: Record<ButtonAction, string> = {
      package: '购买套餐',
      address: '地址管理',
      wallet: '钱包查询',
      text: '提示',
      url: '链接',
      start: '首页',
      refresh: '刷新'
    };
    return `${labels[button.action]} ${rowIndex + 1}`;
  }

  buttonText(button: MenuButton, rowIndex = 0): string {
    return button.text || this.defaultButtonText(button, rowIndex);
  }

  addRow(): void {
    const row: MenuRow = { id: this.newId(), buttons: [], style: { gap: 6 } };
    this.menuRows.update(rows => [...rows, row]);
    this.selectRow(row.id);
  }

  addButton(action: ButtonAction): void {
    const rows = [...this.menuRows()];
    let targetRow = rows.find(row => row.id === this.selection().rowId);
    if (!targetRow) {
      targetRow = rows.at(-1);
    }
    if (!targetRow) {
      targetRow = { id: this.newId(), buttons: [], style: { gap: 6 } };
      rows.push(targetRow);
    }
    const button: MenuButton = {
      id: this.newId(),
      text: '',
      action,
      packageId: action === 'package' ? null : undefined,
      message: action === 'text' ? '' : undefined,
      url: action === 'url' ? '' : undefined,
      style: { ...COLOR_PRESETS[0] }
    };
    targetRow.buttons = [...targetRow.buttons, button];
    this.menuRows.set(rows);
    this.selectButton(targetRow.id, button.id);
  }

  addStyledButton(action: ButtonAction, preset: ColorPreset, emoji?: string): void {
    this.addButton(action);
    const button = this.selectedButton();
    if (button) {
      button.style = { bgColor: preset.bgColor, textColor: preset.textColor, emoji };
      this.touchDesigner();
    }
  }

  selectRow(rowId: string): void {
    this.selection.set({ type: 'row', rowId, buttonId: null });
  }

  selectButton(rowId: string, buttonId: string): void {
    this.selection.set({ type: 'button', rowId, buttonId });
  }

  clearSelection(): void {
    this.selection.set({ type: null, rowId: null, buttonId: null });
  }

  removeSelected(): void {
    const selection = this.selection();
    if (!selection.type || !selection.rowId) {
      return;
    }
    if (selection.type === 'row') {
      this.menuRows.update(rows => rows.filter(row => row.id !== selection.rowId));
      this.clearSelection();
      return;
    }
    this.menuRows.update(rows =>
      rows.map(row =>
        row.id === selection.rowId ? { ...row, buttons: row.buttons.filter(button => button.id !== selection.buttonId) } : row
      )
    );
    this.selectRow(selection.rowId);
  }

  duplicateButton(): void {
    const selection = this.selection();
    if (selection.type !== 'button' || !selection.rowId || !selection.buttonId) {
      return;
    }
    const rows = [...this.menuRows()];
    const row = rows.find(item => item.id === selection.rowId);
    const index = row?.buttons.findIndex(button => button.id === selection.buttonId) ?? -1;
    if (!row || index < 0) {
      return;
    }
    const clone: MenuButton = {
      ...row.buttons[index],
      id: this.newId(),
      style: { ...row.buttons[index].style }
    };
    row.buttons.splice(index + 1, 0, clone);
    this.menuRows.set(rows);
    this.selectButton(row.id, clone.id);
  }

  moveSelected(direction: -1 | 1): void {
    const selection = this.selection();
    const rows = [...this.menuRows()];
    if (selection.type === 'row' && selection.rowId) {
      const index = rows.findIndex(row => row.id === selection.rowId);
      const targetIndex = index + direction;
      if (index >= 0 && targetIndex >= 0 && targetIndex < rows.length) {
        moveItemInArray(rows, index, targetIndex);
        this.menuRows.set(rows);
      }
      return;
    }
    if (selection.type === 'button' && selection.rowId && selection.buttonId) {
      const row = rows.find(item => item.id === selection.rowId);
      const index = row?.buttons.findIndex(button => button.id === selection.buttonId) ?? -1;
      const targetIndex = index + direction;
      if (row && index >= 0 && targetIndex >= 0 && targetIndex < row.buttons.length) {
        moveItemInArray(row.buttons, index, targetIndex);
        this.menuRows.set(rows);
      }
    }
  }

  dropRow(event: CdkDragDrop<MenuRow[]>): void {
    const rows = [...this.menuRows()];
    moveItemInArray(rows, event.previousIndex, event.currentIndex);
    this.menuRows.set(rows);
  }

  dropButton(event: CdkDragDrop<MenuButton[]>, row: MenuRow): void {
    const rows = [...this.menuRows()];
    if (event.previousContainer === event.container) {
      moveItemInArray(row.buttons, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
    }
    this.menuRows.set(rows);
  }

  setButtonAction(action: ButtonAction): void {
    const button = this.selectedButton();
    if (!button) {
      return;
    }
    button.action = action;
    button.packageId = action === 'package' ? (button.packageId ?? null) : undefined;
    button.message = action === 'text' ? (button.message ?? '') : undefined;
    button.url = action === 'url' ? (button.url ?? '') : undefined;
    this.touchDesigner();
  }

  applyPreset(preset: ColorPreset): void {
    const button = this.selectedButton();
    if (!button) {
      return;
    }
    button.style = { ...(button.style || {}), bgColor: preset.bgColor, textColor: preset.textColor };
    this.touchDesigner();
  }

  setButtonEmoji(emoji: string, suffix = false): void {
    const button = this.selectedButton();
    if (!button) {
      return;
    }
    button.style = { ...(button.style || {}), [suffix ? 'emojiSuffix' : 'emoji']: emoji || undefined };
    this.touchDesigner();
  }

  resetButtonStyle(): void {
    const button = this.selectedButton();
    if (!button) {
      return;
    }
    button.style = {};
    this.touchDesigner();
  }

  touchDesigner(): void {
    this.menuRows.set([...this.menuRows()]);
  }

  loadConfig(): void {
    this.loading.set(true);
    forkJoin({
      config: this.dataService.getAgentBotConfig(),
      runtime: this.dataService.getBotRuntimeStatus(),
      packages: this.dataService.getPackages({ pageIndex: 1, pageSize: 200, filters: { status: 'active' } })
    })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ config: data, runtime, packages }) => {
        this.config.set(data);
        this.runtime.set(runtime);
        this.packages.set(packages.list || []);
        const messageConfig = this.parseMessageConfig(data.messageConfig);
        this.form.patchValue({
          botStatus: data.botStatus || 'disabled',
          telegramBotToken: '',
          telegramBotUsername: data.telegramBotUsername || '',
          welcomeText: data.welcomeText || '',
          orderCreated: messageConfig['orderCreated'] || '',
          payPending: messageConfig['payPending'] || '',
          paySuccess: messageConfig['paySuccess'] || '',
          payFailed: messageConfig['payFailed'] || '',
          noPackage: messageConfig['noPackage'] || '',
          unknownCommand: messageConfig['unknownCommand'] || '',
          remark: data.remark || ''
        });
        this.menuRows.set(this.parseMenuConfig(data.menuConfig));
        this.clearSelection();
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
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.dataService
      .updateAgentBotConfig({
        botStatus: raw.botStatus,
        telegramBotToken: raw.telegramBotToken,
        telegramBotUsername: raw.telegramBotUsername,
        welcomeText: raw.welcomeText,
        messageConfig: JSON.stringify({
          orderCreated: raw.orderCreated,
          payPending: raw.payPending,
          paySuccess: raw.paySuccess,
          payFailed: raw.payFailed,
          noPackage: raw.noPackage,
          unknownCommand: raw.unknownCommand
        }),
        menuConfig: this.serializeMenuConfig(),
        remark: raw.remark
      })
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.loadConfig());
  }

  ngOnInit(): void {
    this.loadConfig();
  }

  private parseMessageConfig(raw?: string): Record<string, string> {
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private parseMenuConfig(raw?: string): MenuRow[] {
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      if (parsed.length > 0 && Array.isArray(parsed[0]?.buttons)) {
        return parsed.map((row: any) => ({
          id: String(row.id || this.newId()),
          style: row.style || { gap: 6 },
          buttons: Array.isArray(row.buttons) ? row.buttons.map((button: any) => this.normalizeButton(button)) : []
        }));
      }
      return parsed.map((button: any) => ({
        id: this.newId(),
        style: { gap: 6 },
        buttons: [this.normalizeButton(button)]
      }));
    } catch {
      return [];
    }
  }

  private normalizeButton(raw: any): MenuButton {
    const action = this.normalizeAction(raw?.action);
    return {
      id: String(raw?.id || this.newId()),
      text: String(raw?.text || ''),
      action,
      packageId: raw?.packageId === undefined || raw?.packageId === null || raw?.packageId === '' ? null : Number(raw.packageId),
      url: raw?.url || '',
      message: raw?.message || '',
      command: raw?.command || '',
      style: raw?.style || {}
    };
  }

  private normalizeAction(value: unknown): ButtonAction {
    return ['package', 'address', 'wallet', 'text', 'url', 'start', 'refresh'].includes(String(value))
      ? (value as ButtonAction)
      : 'package';
  }

  private serializeMenuConfig(): string {
    return JSON.stringify(
      this.menuRows().map((row, rowIndex) => ({
        id: row.id,
        row: rowIndex,
        style: row.style,
        buttons: row.buttons.map((button, sort) => ({
          id: button.id,
          text: button.text,
          action: button.action,
          packageId: button.packageId,
          url: button.url,
          message: button.message,
          command: button.command,
          style: button.style,
          sort
        }))
      }))
    );
  }

  private newId(): string {
    return `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
