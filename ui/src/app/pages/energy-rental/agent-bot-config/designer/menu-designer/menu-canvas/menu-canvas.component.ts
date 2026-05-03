import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { NzBreadCrumbModule } from 'ng-zorro-antd/breadcrumb';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import {
  ButtonAction,
  MAX_BUTTONS_PER_ROW,
  MAX_ROWS_PER_MENU,
  MenuButton,
} from '../../types';
import { ACTION_ICON_MAP, ACTION_TITLE_MAP } from '../action-icons';
import { PaletteItem } from '../component-palette/component-palette.component';
import { MenuTreeService } from '../menu-tree.service';

/**
 * MenuCanvas 中央画布（任务 16）。
 *
 * 职责：
 * 1. 面包屑导航：展示/切换 MenuTreeService.$breadcrumb
 * 2. 行/按钮可视化：读取 $currentMenu 渲染网格
 * 3. 拖拽目标：cdkDropList 接收 ComponentPalette 拖入，创建新按钮
 * 4. 按钮交互：点击选中 / 删除（popconfirm）/ 双击 SUBMENU 下钻
 *
 * 当前未实现（TODO 下一个任务）：
 * - 同画布内按钮排序（cdkDropList 的 moveItemInArray / transferArrayItem
 *   对 signal-based 不友好，且涉及跨行拖拽的校验，单独任务展开）。
 */
@Component({
  selector: 'app-menu-canvas',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    NzBreadCrumbModule,
    NzButtonModule,
    NzEmptyModule,
    NzIconModule,
    NzPopconfirmModule,
    NzTooltipModule,
  ],
  templateUrl: './menu-canvas.component.html',
  styleUrls: ['./menu-canvas.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuCanvasComponent {
  readonly tree = inject(MenuTreeService);

  // 直接暴露 signals 给模板（保持响应式）
  readonly $breadcrumb = this.tree.$breadcrumb;
  readonly $currentMenu = this.tree.$currentMenu;
  readonly $selectedId = this.tree.$selectedButtonId;

  readonly maxRows = MAX_ROWS_PER_MENU;
  readonly maxButtonsPerRow = MAX_BUTTONS_PER_ROW;

  /** 新行占位 dropList 的空数据（显式类型避免模板推断成 never[]）。 */
  readonly emptyButtonList: MenuButton[] = [];

  readonly $canAddRow = computed(() => this.$currentMenu().length < this.maxRows);

  readonly actionIconMap = ACTION_ICON_MAP;
  readonly actionTitleMap = ACTION_TITLE_MAP;

  /**
   * 让 palette 和每个 row 组成一个 dropList 组：
   * 用 cdkDropListGroup 自动连通更方便——模板里对 `.canvas-rows` 打 cdkDropListGroup；
   * palette 组件内部也已套 cdkDropListGroup。
   *
   * 只要 palette 与 canvas 同时渲染在同一文档内，Angular CDK
   * 会沿 DOM 树找到 group 边界——外层 designer 容器打一层 cdkDropListGroup
   * 即可覆盖两侧。保险起见，这里每行 list 仍暴露稳定 id，方便父组件做 connectedTo。
   */
  rowListId(rowIdx: number): string {
    return `canvas-row-${rowIdx}`;
  }

  /** 额外的"新行"落点 id——拖到行与行之间 / 最底部 */
  readonly newRowListId = 'canvas-new-row';

  // ---------- 面包屑 ----------
  navigateCrumb(index: number): void {
    this.tree.navigateTo(index);
  }

  // ---------- 行 ----------
  addEmptyRow(): void {
    if (!this.$canAddRow()) return;
    this.tree.addRow();
  }

  // ---------- 按钮 ----------
  selectButton(buttonId: string): void {
    this.tree.$selectedButtonId.set(buttonId);
  }

  removeButton(buttonId: string): void {
    this.tree.removeButton(buttonId);
  }

  enterButtonSubmenu(btn: MenuButton): void {
    if (btn.action !== ButtonAction.SUBMENU) return;
    this.tree.enterSubmenu(btn.id);
  }

  trackByButtonId = (_: number, btn: MenuButton): string => btn.id;
  trackByRowId = (_: number, row: { id: string }): string => row.id;

  // ---------- 拖拽 ----------
  /**
   * 放到已有行。
   * - palette 来源：创建新按钮（带行内上限校验）。
   * - 同画布来源：排序/跨行移动暂未实现（TODO：后续任务）。
   */
  onDropToRow(event: CdkDragDrop<MenuButton[]>, rowIdx: number): void {
    const paletteItem = this.extractPaletteItem(event);
    if (!paletteItem) {
      // TODO 任务 17+：同画布内 move/reorder
      return;
    }
    const rows = this.$currentMenu();
    const row = rows[rowIdx];
    if (!row) return;
    if (row.buttons.length >= this.maxButtonsPerRow) return;

    const btn = this.createButtonFromPalette(paletteItem);
    this.tree.addButton(rowIdx, btn);
  }

  /** 拖到"新行"落点。超行数上限拒绝；否则先 addRow 再 addButton 到新末行。 */
  onDropToNewRow(event: CdkDragDrop<MenuButton[]>): void {
    const paletteItem = this.extractPaletteItem(event);
    if (!paletteItem) return;
    if (!this.$canAddRow()) return;

    this.tree.addRow();
    // addRow 同步写完后，$currentMenu().length - 1 即新行索引
    const newIdx = this.$currentMenu().length - 1;
    const btn = this.createButtonFromPalette(paletteItem);
    this.tree.addButton(newIdx, btn);
  }

  // ---------- 内部：拖拽辅助 ----------

  /**
   * 从 drop 事件中抽出 palette item。
   *
   * 判定条件：previousContainer !== container（跨 list）且 item.data 是合法 PaletteItem。
   * 注意：Angular CDK 在同一 dropListGroup 里不同 list 间拖拽时 previousContainer
   *       才不等于 container。
   */
  private extractPaletteItem(event: CdkDragDrop<MenuButton[]>): PaletteItem | null {
    if (event.previousContainer === event.container) return null;
    const data = event.item?.data as PaletteItem | null | undefined;
    if (!data || typeof data !== 'object') return null;
    if (typeof (data as PaletteItem).action !== 'string') return null;
    return data as PaletteItem;
  }

  /**
   * 按 action 填充默认字段：
   * - URL → url: ''
   * - TEXT → message: ''
   * - COMMAND → command: '/start'
   * - SUBMENU → submenu: []
   * - ENERGY_PACKAGE_GROUP → packageGroup: 默认占位
   * - 其他（START/ADDRESS_MANAGE/WALLET_QUERY/ORDERS）→ 不带额外字段
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
