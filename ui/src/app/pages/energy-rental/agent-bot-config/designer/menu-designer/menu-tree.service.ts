import { computed, Injectable, signal } from '@angular/core';

import { ButtonAction, MAX_MENU_DEPTH, MenuButton, MenuRow } from '../types';

/**
 * breadcrumb 单项：根节点 buttonId = null，其余为承载 submenu 的按钮 id。
 */
export interface BreadcrumbItem {
  label: string;
  buttonId: string | null;
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

  private history: MenuRow[][] = [];
  private future: MenuRow[][] = [];

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
    this.future.push(structuredClone(this.$rootMenu()));
    const prev = this.history.pop()!;
    this.$rootMenu.set(prev);
  }

  redo(): void {
    if (this.future.length === 0) return;
    this.history.push(structuredClone(this.$rootMenu()));
    const next = this.future.pop()!;
    this.$rootMenu.set(next);
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
   */
  setRootMenu(menu: MenuRow[]): void {
    this.history = [];
    this.future = [];
    this.$rootMenu.set(menu);
    this.$breadcrumb.set([{ label: '根菜单', buttonId: null }]);
    this.$selectedButtonId.set(null);
  }

  // ----- 内部辅助 -----

  private pushHistory(): void {
    this.history.push(structuredClone(this.$rootMenu()));
    if (this.history.length > MenuTreeService.MAX_HISTORY) this.history.shift();
    this.future = [];
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
