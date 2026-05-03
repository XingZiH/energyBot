import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { NzBreadCrumbModule } from 'ng-zorro-antd/breadcrumb';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import {
  ButtonAction,
  MAX_BUTTONS_PER_ROW,
  MAX_ROWS_PER_MENU,
  MenuButton,
  MenuRow,
} from '../../types';
import { PaletteItem } from '../component-palette/component-palette.component';
import { MenuTreeService } from '../menu-tree.service';

/**
 * TelegramPreview（预览 + 编辑合一，对齐 teledashFront 的 UX）。
 *
 * 这是设计器 v2 的唯一菜单编辑入口：
 * - 视觉上模拟 Telegram Desktop 聊天界面（phone frame + header + bubble + keyboard）
 * - 同时承担 MenuCanvas 原有的编辑职责：选中、删除、下钻、面包屑导航、拖拽排序/新建
 *
 * ## 层级渲染差异
 * - 根层（breadcrumb.length === 1） → Reply Keyboard 风格（底部常驻，无下钻箭头）
 * - 子层（breadcrumb.length > 1）    → Inline Keyboard 风格（气泡下方，SUBMENU 带右箭头）
 *
 * ## 拖拽
 * - 每行是独立的 `cdkDropList`，接受：
 *   1. 来自 ComponentPalette 的新建按钮（previousContainer !== container 且 data 是 PaletteItem）
 *   2. 来自其他行的按钮（跨行移动）
 *   3. 同行内排序（reorder）
 * - 额外一个"拖到此新建一行"落点，容量上限前一直显示
 * - drop 回调通过 rowIdx 区分目标；palette 来源走 createButtonFromPalette，
 *   非 palette 来源根据 previousContainer.id 解析源行 idx。
 *
 * ## 主题
 * - Telegram 风格配色**硬编码**（见 .less 头部，全项目唯一例外）
 * - $darkMode 切换独立于系统主题
 */
@Component({
  selector: 'app-telegram-preview',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    NzBreadCrumbModule,
    NzButtonModule,
    NzIconModule,
    NzPopconfirmModule,
    NzTooltipModule,
  ],
  templateUrl: './telegram-preview.component.html',
  styleUrls: ['./telegram-preview.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelegramPreviewComponent {
  readonly tree = inject(MenuTreeService);

  readonly $currentMenu = this.tree.$currentMenu;
  readonly $breadcrumb = this.tree.$breadcrumb;
  readonly $welcomeText = this.tree.$welcomeText;
  readonly $selectedId = this.tree.$selectedButtonId;

  readonly ButtonAction = ButtonAction;
  readonly maxRows = MAX_ROWS_PER_MENU;
  readonly maxButtonsPerRow = MAX_BUTTONS_PER_ROW;

  /** 明/暗主题预览切换（独立于系统主题） */
  readonly $darkMode = signal(false);

  /**
   * 约定：根层用 Reply Keyboard，子层用 Inline Keyboard。
   * 与实际 Telegram Bot 常见模式一致：主菜单常驻底部键盘，子菜单则随消息 inline。
   */
  readonly $isInline = computed(() => this.$breadcrumb().length > 1);

  readonly $canAddRow = computed(() => this.$currentMenu().length < this.maxRows);

  /** welcomeText 空时的气泡占位——提示用户去顶部 textarea 配置 */
  static readonly WELCOME_TEXT_FALLBACK =
    '/start 后机器人将回复此文案，在顶部「欢迎语」输入框填写…';

  /**
   * Bot 气泡显示内容：
   * - welcomeText 非空 → 原样显示（用户真实的 /start 回复）
   * - welcomeText 为空 → 固定占位提示，引导用户去顶部输入框填写
   *
   * 注意：即使菜单里已有按钮，welcomeText 为空时也显示占位，
   * 因为 bot 的 /start 逻辑里 welcomeText 才是首条消息，按钮只是附带。
   */
  readonly $bubbleText = computed(() => {
    const w = this.$welcomeText().trim();
    return w || TelegramPreviewComponent.WELCOME_TEXT_FALLBACK;
  });

  /** 占位用户气泡的固定时间显示——纯装饰 */
  readonly USER_BUBBLE_TIME = '22:33';
  /** 占位机器人名 */
  readonly BOT_DISPLAY_NAME = '我的机器人';
  /** 占位机器人头像字母（用首字母圈） */
  readonly BOT_AVATAR_LETTER = 'B';

  readonly $breadcrumbText = computed(() =>
    this.$breadcrumb()
      .map((c) => c.label)
      .join(' > '),
  );

  /** 每行 drop list id（供 connectedTo 联通，虽然 cdkDropListGroup 会自动处理） */
  rowListId(rowIdx: number): string {
    return `preview-row-${rowIdx}`;
  }

  /** 新行落点 drop list id */
  readonly newRowListId = 'preview-new-row';

  /**
   * 新行/空态落点的 `cdkDropListData`。
   *
   * 必须走字段暴露：模板里直接写 `[cdkDropListData]="[]"` 会被 Angular
   * 模板类型检查推断为 `never[]`，与 `(cdkDropListDropped)` 期望的
   * `CdkDragDrop<MenuButton[]>` 参数不兼容，build 报 TS2345。
   */
  readonly emptyButtons: MenuButton[] = [];

  toggleDarkMode(): void {
    this.$darkMode.update((v) => !v);
  }

  // ---------- 面包屑 ----------
  navigateCrumb(index: number): void {
    this.tree.navigateTo(index);
  }

  // ---------- 按钮交互 ----------
  selectButton(buttonId: string, ev?: Event): void {
    ev?.stopPropagation();
    this.tree.$selectedButtonId.set(buttonId);
  }

  removeButton(buttonId: string): void {
    this.tree.removeButton(buttonId);
  }

  enterButtonSubmenu(btn: MenuButton): void {
    if (btn.action !== ButtonAction.SUBMENU) return;
    this.tree.enterSubmenu(btn.id);
  }

  getButtonTooltip(btn: MenuButton): string {
    return `${btn.text || '(未命名)'} · ${btn.action}`;
  }

  // ---------- 拖拽 ----------

  /**
   * 放到已有行：三种来源分流。
   * 1. palette 新建：校验行容量后 addButton
   * 2. 同一 previewRow（容器 id 相同）：reorder
   * 3. 其他 previewRow：跨行 move，容量不足时静默忽略
   */
  onDropToRow(event: CdkDragDrop<MenuButton[]>, rowIdx: number): void {
    // palette 分支
    const paletteItem = this.extractPaletteItem(event);
    if (paletteItem) {
      const rows = this.$currentMenu();
      const row = rows[rowIdx];
      if (!row) return;
      if (row.buttons.length >= this.maxButtonsPerRow) return;
      const btn = this.createButtonFromPalette(paletteItem);
      this.tree.addButton(rowIdx, btn);
      return;
    }

    // 同 preview 行内或跨 preview 行拖拽
    const fromRowIdx = this.parseRowIdxFromContainerId(event.previousContainer.id);
    if (fromRowIdx === null) return;

    if (fromRowIdx === rowIdx) {
      this.tree.reorderButtonInRow(rowIdx, event.previousIndex, event.currentIndex);
      return;
    }
    // 跨行移动：service 内做容量校验，超限返回 false 且不改状态
    this.tree.moveButton(fromRowIdx, event.previousIndex, rowIdx, event.currentIndex);
  }

  /**
   * 拖到"新行"落点：palette → addRow + addButton；已有按钮 → moveButtonToNewRow。
   */
  onDropToNewRow(event: CdkDragDrop<MenuButton[]>): void {
    const paletteItem = this.extractPaletteItem(event);
    if (paletteItem) {
      if (!this.$canAddRow()) return;
      this.tree.addRow();
      const newIdx = this.$currentMenu().length - 1;
      const btn = this.createButtonFromPalette(paletteItem);
      this.tree.addButton(newIdx, btn);
      return;
    }

    const fromRowIdx = this.parseRowIdxFromContainerId(event.previousContainer.id);
    if (fromRowIdx === null) return;
    this.tree.moveButtonToNewRow(fromRowIdx, event.previousIndex);
  }

  trackByRowId = (_: number, row: MenuRow): string => row.id;
  trackByButtonId = (_: number, btn: MenuButton): string => btn.id;

  // ---------- 内部：拖拽辅助 ----------

  /**
   * palette item 判定：previousContainer !== container 且 data 是合法 PaletteItem。
   *
   * 注意：cross-row 拖拽 previousContainer 也 !== container，所以不能单凭 previous!=current
   * 判断 palette 来源；必须同时验证 item.data 的 action 字段（palette 的 drag data 带 action，
   * cdk drag 的默认 data 是 MenuButton 对象）。
   */
  private extractPaletteItem(event: CdkDragDrop<MenuButton[]>): PaletteItem | null {
    if (event.previousContainer === event.container) return null;
    const data = event.item?.data as PaletteItem | MenuButton | null | undefined;
    if (!data || typeof data !== 'object') return null;
    // MenuButton 有 id 字段；PaletteItem 没有 id 只有 action/icon/title/description
    if ('id' in (data as object)) return null;
    if (typeof (data as PaletteItem).action !== 'string') return null;
    return data as PaletteItem;
  }

  /** 从 preview-row-{idx} 格式的 id 解析 rowIdx。非预期容器返回 null。 */
  private parseRowIdxFromContainerId(id: string): number | null {
    const m = /^preview-row-(\d+)$/.exec(id);
    if (!m) return null;
    const idx = Number(m[1]);
    return Number.isFinite(idx) ? idx : null;
  }

  /**
   * 根据 palette item 的 action 填充默认字段。
   * 逻辑沿用自原 MenuCanvas：
   * - URL → url: ''
   * - TEXT → message: ''
   * - COMMAND → command: '/start'
   * - SUBMENU → submenu: []
   * - ENERGY_PACKAGE_GROUP → 默认 packageGroup
   * - START / ADDRESS_MANAGE / WALLET_QUERY / ORDERS → 不带额外字段
   */
  private createButtonFromPalette(item: PaletteItem): MenuButton {
    const base: MenuButton = {
      id: this.genId(),
      text: item.title,
      action: item.action,
    };
    switch (item.action) {
      case ButtonAction.URL:
        return { ...base, url: '' };
      case ButtonAction.TEXT:
        return { ...base, message: '' };
      case ButtonAction.COMMAND:
        return { ...base, command: '/start' };
      case ButtonAction.SUBMENU:
        return { ...base, submenu: [] };
      case ButtonAction.ENERGY_PACKAGE_GROUP:
        return {
          ...base,
          packageGroup: { packageIds: [], sortBy: 'price_asc', textTemplate: '' },
        };
      case ButtonAction.START:
      case ButtonAction.ADDRESS_MANAGE:
      case ButtonAction.WALLET_QUERY:
      case ButtonAction.ORDERS:
      default:
        return base;
    }
  }

  private genId(): string {
    return `btn_${Math.random().toString(36).slice(2, 10)}`;
  }
}
