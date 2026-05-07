import { computed, Injectable, signal } from '@angular/core';

import {
  ButtonAction,
  MAX_BUTTONS_PER_ROW,
  MAX_MENU_DEPTH,
  MAX_ROWS_PER_MENU,
  MenuButton,
  MenuRow,
} from '../types';

/**
 * breadcrumb 单项：根节点 buttonId = null，其余为承载 submenu 的按钮 id。
 */
export interface BreadcrumbItem {
  label: string;
  buttonId: string | null;
}

/**
 * 历史栈快照：同时包含 rootMenu 与 welcomeText，
 * undo/redo 需要对二者做原子回滚（例如同一步操作改了菜单又改了文本）。
 */
interface HistorySnapshot {
  rootMenu: MenuRow[];
  welcomeText: string;
  packageGroupText: string;
}

/**
 * MenuTreeService
 *
 * 菜单树状态管理（Signal-based）：
 * - 根菜单 / 当前路径 / 选中按钮 三组 signal
 * - addRow / addButton / updateButton / removeButton / enterSubmenu / navigateTo 写操作
 * - undo / redo：历史最多 50 步，快照用 structuredClone 深拷贝
 * - validateDepth：递归校验嵌套深度，超 MAX_MENU_DEPTH 抛错
 *
 * 设计注意：
 * 1. 未用 providedIn，调用方（如 menu-designer 组件）自行在 providers 中声明，
 *    以便多设计器实例各自独立。
 * 2. 写操作统一走 updateCurrentMenu，根层直接更新、深层 structuredClone 重建路径。
 */
@Injectable()
export class MenuTreeService {
  readonly $rootMenu = signal<MenuRow[]>([]);
  readonly $breadcrumb = signal<BreadcrumbItem[]>([{ label: '根菜单', buttonId: null }]);
  readonly $selectedButtonId = signal<string | null>(null);

  /**
   * 聊天气泡正文（designer 顶部文本框）。
   *
   * 独立于 $rootMenu：`setWelcomeText` 直接写入不进历史，文本频繁改动，
   * 避免每次按键都创建快照污染 undo 栈；需要 undo 语义时走 `setWelcomeTextWithHistory`
   * （例如 blur 时再快照一次）。
   */
  readonly $welcomeText = signal<string>('');

  /**
   * 套餐组提示文案（所有套餐组共享，用户点击套餐组按钮时展示的文案）。
   * 与 $welcomeText 同模式：高频输入不进历史栈，blur 时走 setPackageGroupTextWithHistory。
   */
  readonly $packageGroupText = signal<string>('');

  readonly $currentMenu = computed<MenuRow[]>(() => {
    const crumbs = this.$breadcrumb();
    let current = this.$rootMenu();
    for (let i = 1; i < crumbs.length; i++) {
      const btnId = crumbs[i].buttonId;
      if (btnId === null) return [];
      const btn = this.findButtonInRows(current, btnId);
      if (!btn || !btn.submenu) return [];
      current = btn.submenu;
    }
    return current;
  });

  private history: HistorySnapshot[] = [];
  private future: HistorySnapshot[] = [];

  private static readonly MAX_HISTORY = 50;

  addRow(): void {
    this.pushHistory();
    this.updateCurrentMenu((rows) => [
      ...rows,
      { id: this.genId('row'), buttons: [] },
    ]);
  }

  addButton(rowIdx: number, button: MenuButton): void {
    this.pushHistory();
    this.updateCurrentMenu((rows) => {
      const updated = structuredClone(rows);
      if (updated[rowIdx]) updated[rowIdx].buttons.push(button);
      return updated;
    });
  }

  updateButton(buttonId: string, patch: Partial<MenuButton>): void {
    this.pushHistory();
    this.updateCurrentMenu((rows) => {
      const updated = structuredClone(rows);
      for (const row of updated) {
        const idx = row.buttons.findIndex((b) => b.id === buttonId);
        if (idx >= 0) {
          row.buttons[idx] = { ...row.buttons[idx], ...patch };
          return updated;
        }
      }
      return updated;
    });
  }

  removeButton(buttonId: string): void {
    this.pushHistory();
    this.updateCurrentMenu((rows) => {
      const updated = structuredClone(rows);
      for (const row of updated) {
        row.buttons = row.buttons.filter((b) => b.id !== buttonId);
      }
      return updated.filter((r) => r.buttons.length > 0);
    });
  }

  enterSubmenu(buttonId: string): void {
    const btn = this.findButtonInRows(this.$currentMenu(), buttonId);
    if (!btn || btn.action !== ButtonAction.SUBMENU) return;
    // 若 SUBMENU 按钮尚未创建 submenu，先补一个空数组（通过 updateButton 走写路径）
    if (!btn.submenu) {
      this.updateButton(buttonId, { submenu: [] });
    }
    this.$breadcrumb.update((crumbs) => [
      ...crumbs,
      { label: btn.text || '未命名', buttonId },
    ]);
  }

  navigateTo(index: number): void {
    this.$breadcrumb.update((crumbs) => crumbs.slice(0, index + 1));
  }

  undo(): void {
    if (this.history.length === 0) return;
    this.future.push(this.snapshot());
    const prev = this.history.pop()!;
    this.applySnapshot(prev);
  }

  redo(): void {
    if (this.future.length === 0) return;
    this.history.push(this.snapshot());
    const next = this.future.pop()!;
    this.applySnapshot(next);
  }

  /**
   * 递归校验菜单嵌套深度。根层深度 = 1；每层 SUBMENU 向下 +1。
   * depth > MAX_MENU_DEPTH 时抛错。
   */
  validateDepth(rows: MenuRow[], depth = 1): void {
    if (depth > MAX_MENU_DEPTH) {
      throw new Error(`菜单嵌套深度不能超过 ${MAX_MENU_DEPTH} 层`);
    }
    for (const row of rows) {
      for (const btn of row.buttons) {
        if (btn.action === ButtonAction.SUBMENU && btn.submenu?.length) {
          this.validateDepth(btn.submenu, depth + 1);
        }
      }
    }
  }

  /**
   * 初始化/重置菜单，同时清空历史栈、复位 breadcrumb 和选中状态。
   *
   * 注意：不清空 $welcomeText。welcomeText 走独立初始化入口（setWelcomeText），
   * 当父组件只刷新菜单快照时不应把文案重置为空。
   */
  setRootMenu(menu: MenuRow[]): void {
    this.history = [];
    this.future = [];
    this.$rootMenu.set(menu);
    this.$breadcrumb.set([{ label: '根菜单', buttonId: null }]);
    this.$selectedButtonId.set(null);
  }

  /**
   * 直接写入 welcomeText（不进历史栈）。
   *
   * 适用于 IME 打字、父组件初始化等高频/非用户显式编辑完成场景。
   * 需要 undo 粒度时请用 setWelcomeTextWithHistory。
   */
  setWelcomeText(value: string): void {
    this.$welcomeText.set(value);
  }

  /**
   * 把 welcomeText 变更当作一步可撤销操作记入历史。
   *
   * 推荐在输入框 blur 或"编辑会话结束"时调用一次，配合 setWelcomeText
   * 的实时写入形成"实时预览 + 离焦入栈"两阶段语义。
   */
  setWelcomeTextWithHistory(value: string): void {
    if (this.$welcomeText() === value) return;
    this.pushHistory();
    this.$welcomeText.set(value);
  }

  /**
   * 直接写入 packageGroupText（不进历史栈）。
   */
  setPackageGroupText(value: string): void {
    this.$packageGroupText.set(value);
  }

  /**
   * 把 packageGroupText 变更当作一步可撤销操作记入历史。
   */
  setPackageGroupTextWithHistory(value: string): void {
    if (this.$packageGroupText() === value) return;
    this.pushHistory();
    this.$packageGroupText.set(value);
  }

  // ---------- 拖拽写操作 ----------

  /**
   * 行内按钮位置交换（拖拽排序）。
   *
   * fromIdx === toIdx 视为 no-op（不推历史、不改状态），避免拖到原位触发
   * 一次无意义的 history push。
   */
  reorderButtonInRow(rowIdx: number, fromIdx: number, toIdx: number): void {
    if (fromIdx === toIdx) return;
    this.pushHistory();
    this.updateCurrentMenu((rows) => {
      const updated = structuredClone(rows);
      const row = updated[rowIdx];
      if (!row) return updated;
      if (fromIdx < 0 || fromIdx >= row.buttons.length) return updated;
      if (toIdx < 0 || toIdx >= row.buttons.length) return updated;
      const [btn] = row.buttons.splice(fromIdx, 1);
      row.buttons.splice(toIdx, 0, btn);
      return updated;
    });
  }

  /**
   * 跨行移动按钮。
   *
   * 返回 boolean：
   * - false：目标行已满（MAX_BUTTONS_PER_ROW）或源/目标非法，整个操作不生效且不入栈
   * - true：移动成功；若源行因此变空会被自动移除（与 removeButton 行为一致）
   */
  moveButton(
    fromRowIdx: number,
    fromBtnIdx: number,
    toRowIdx: number,
    toBtnIdx: number,
  ): boolean {
    const rows = this.$currentMenu();
    const fromRow = rows[fromRowIdx];
    const toRow = rows[toRowIdx];
    if (!fromRow || !toRow) return false;
    if (fromBtnIdx < 0 || fromBtnIdx >= fromRow.buttons.length) return false;
    // 同行内退化到 reorder（不触发容量检查：总数不变）
    if (fromRowIdx === toRowIdx) {
      const clamped = Math.max(0, Math.min(toBtnIdx, fromRow.buttons.length - 1));
      this.reorderButtonInRow(fromRowIdx, fromBtnIdx, clamped);
      return true;
    }
    if (toRow.buttons.length >= MAX_BUTTONS_PER_ROW) return false;

    this.pushHistory();
    this.updateCurrentMenu((rs) => {
      const updated = structuredClone(rs);
      const src = updated[fromRowIdx];
      const dst = updated[toRowIdx];
      if (!src || !dst) return updated;
      const [btn] = src.buttons.splice(fromBtnIdx, 1);
      const insertAt = Math.max(0, Math.min(toBtnIdx, dst.buttons.length));
      dst.buttons.splice(insertAt, 0, btn);
      return updated.filter((r) => r.buttons.length > 0);
    });
    return true;
  }

  /**
   * 把一个按钮拆到末尾新行。
   *
   * 返回 false 的情况：
   * - 当前菜单已达 MAX_ROWS_PER_MENU 且源行会被保留（拆出去仍需新增一行）
   * - 源定位非法
   *
   * 特殊情形：若源行仅此一个按钮，拆出后源行为空会被删除——
   * 这种情况总行数不变，不触碰行数上限。
   */
  moveButtonToNewRow(fromRowIdx: number, fromBtnIdx: number): boolean {
    const rows = this.$currentMenu();
    const fromRow = rows[fromRowIdx];
    if (!fromRow) return false;
    if (fromBtnIdx < 0 || fromBtnIdx >= fromRow.buttons.length) return false;

    const willEmptySource = fromRow.buttons.length === 1;
    if (!willEmptySource && rows.length >= MAX_ROWS_PER_MENU) return false;

    this.pushHistory();
    this.updateCurrentMenu((rs) => {
      const updated = structuredClone(rs);
      const src = updated[fromRowIdx];
      if (!src) return updated;
      const [btn] = src.buttons.splice(fromBtnIdx, 1);
      const filtered = updated.filter((r) => r.buttons.length > 0);
      filtered.push({ id: this.genId('row'), buttons: [btn] });
      return filtered;
    });
    return true;
  }

  // ----- 内部辅助 -----

  private pushHistory(): void {
    this.history.push(this.snapshot());
    if (this.history.length > MenuTreeService.MAX_HISTORY) this.history.shift();
    this.future = [];
  }

  private snapshot(): HistorySnapshot {
    return {
      rootMenu: structuredClone(this.$rootMenu()),
      welcomeText: this.$welcomeText(),
      packageGroupText: this.$packageGroupText(),
    };
  }

  private applySnapshot(s: HistorySnapshot): void {
    this.$rootMenu.set(s.rootMenu);
    this.$welcomeText.set(s.welcomeText);
    this.$packageGroupText.set(s.packageGroupText);
  }

  /**
   * 当前 breadcrumb 对应层级的写操作统一入口。
   * - 根层：直接 update rootMenu。
   * - 深层：structuredClone 整棵根，沿 breadcrumb 下钻到目标 submenu，替换后回写。
   */
  private updateCurrentMenu(updater: (rows: MenuRow[]) => MenuRow[]): void {
    const crumbs = this.$breadcrumb();
    if (crumbs.length === 1) {
      this.$rootMenu.update(updater);
      return;
    }
    this.$rootMenu.update((rootRows) => {
      const cloned = structuredClone(rootRows);
      let current = cloned;
      // 走到倒数第二层的 submenu 容器
      for (let i = 1; i < crumbs.length - 1; i++) {
        const btnId = crumbs[i].buttonId;
        if (btnId === null) return cloned;
        const btn = this.findButtonInRows(current, btnId);
        if (!btn || !btn.submenu) return cloned;
        current = btn.submenu;
      }
      const lastBtnId = crumbs[crumbs.length - 1].buttonId;
      if (lastBtnId === null) return cloned;
      const targetBtn = this.findButtonInRows(current, lastBtnId);
      if (targetBtn) {
        targetBtn.submenu = updater(targetBtn.submenu ?? []);
      }
      return cloned;
    });
  }

  private findButtonInRows(rows: MenuRow[], id: string): MenuButton | null {
    for (const row of rows) {
      const btn = row.buttons.find((b) => b.id === id);
      if (btn) return btn;
    }
    return null;
  }

  private genId(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
