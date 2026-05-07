import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzColorPickerModule } from 'ng-zorro-antd/color-picker';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzSelectModule } from 'ng-zorro-antd/select';

import {
  ButtonAction,
  ButtonStyle,
  MAX_BUTTON_TEXT_LEN,
  MenuButton,
  MenuRow,
  PackageGroup,
} from '../../types';
import { ACTION_ICON_MAP, ACTION_TITLE_MAP } from '../action-icons';
import { MenuTreeService } from '../menu-tree.service';
import { PackageGroupSelectorComponent } from '../package-group-selector/package-group-selector.component';

/**
 * PropertyPanel 右侧属性面板（任务 17）。
 *
 * 职责：
 * 1. 展示当前选中按钮（$selectedButtonId）的属性编辑表单。
 * 2. 按 action 类型动态渲染字段（通用：text / action；特定：url / message / command /
 *    submenu 入口 / packageGroup / 无配置提示）。
 * 3. 写操作统一走 tree.updateButton(id, patch)。切换 action 时将无关字段设为
 *    `undefined`，借助 MenuTreeService.updateButton 内部 `{...old, ...patch}`
 *    语义将其从对象上"清除"（实际上是赋值为 undefined）。
 *
 * 同步策略：
 * - Signal → UI：$selectedButton computed 深度搜索整棵 $rootMenu 返回按钮对象，
 *   template 中用 `[ngModel]="$selectedButton()?.xxx"` 单向绑定，signal 变化
 *   自动刷新。
 * - UI → Signal：每个输入控件用 `(ngModelChange)` 事件直接调 updateXxx 方法，
 *   间接调 tree.updateButton。不用 ReactiveForm 避免双向同步死循环。
 *
 * 注意：MenuTreeService.updateButton 只在当前 breadcrumb 层级（$currentMenu）
 * 内查找按钮并更新。canvas 的选中态始终对应当前层，故 $selectedButton 深度
 * 搜索仅用于确保找得到（比如程序化设置 selectedId），写入路径与 canvas 一致。
 */
@Component({
  selector: 'app-property-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzColorPickerModule,
    NzDividerModule,
    NzEmptyModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzSelectModule,
    PackageGroupSelectorComponent,
  ],
  templateUrl: './property-panel.component.html',
  styleUrls: ['./property-panel.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropertyPanelComponent {
  readonly tree = inject(MenuTreeService);

  /**
   * 当前 agent ID，传递给 PackageGroupSelector 用于筛选套餐。
   * 由父容器（任务 20 的 MenuDesigner 主容器）通过 `[agentId]` 注入；
   * 默认 null 表示尚未就绪，selector 不会触发加载。
   */
  readonly agentId = input<number | null>(null);

  readonly maxTextLength = MAX_BUTTON_TEXT_LEN;
  readonly ButtonAction = ButtonAction;
  readonly actionIconMap = ACTION_ICON_MAP;
  readonly actionTitleMap = ACTION_TITLE_MAP;

  /** 所有 action 选项列表，用于 select 下拉。 */
  readonly actionOptions: readonly { value: ButtonAction; label: string }[] =
    Object.values(ButtonAction).map((a) => ({ value: a, label: ACTION_TITLE_MAP[a] }));

  /** 排序方式下拉选项。 */
  readonly sortByOptions: readonly {
    value: PackageGroup['sortBy'];
    label: string;
  }[] = [
    { value: 'price_asc', label: '价格升序' },
    { value: 'price_desc', label: '价格降序' },
    { value: 'manual', label: '手动排序' },
  ];

  /**
   * 深度搜索 $rootMenu 返回当前选中按钮；选中 id 不存在或未选中时返回 null。
   * 不限 breadcrumb 层级——即使选中 id 属于非当前层（理论上不会发生），
   * 也能读到按钮快照用于展示。
   */
  readonly $selectedButton = computed<MenuButton | null>(() => {
    const id = this.tree.$selectedButtonId();
    if (!id) return null;
    return this.findButtonDeep(this.tree.$rootMenu(), id);
  });

  /** 按钮文本校验错误提示；空白/超长时为非空字符串，否则为 null。 */
  readonly $textError = computed<string | null>(() => {
    const btn = this.$selectedButton();
    if (!btn) return null;
    const text = btn.text ?? '';
    if (!text.trim()) return '按钮文本不能为空';
    if (text.length > this.maxTextLength) {
      return `按钮文本不能超过 ${this.maxTextLength} 个字符`;
    }
    return null;
  });

  /** URL 校验错误（仅当 action=URL 时生效）。 */
  readonly $urlError = computed<string | null>(() => {
    const btn = this.$selectedButton();
    if (!btn || btn.action !== ButtonAction.URL) return null;
    const url = (btn.url ?? '').trim();
    if (!url) return 'URL 不能为空';
    if (!/^https?:\/\//i.test(url)) return 'URL 必须以 http:// 或 https:// 开头';
    return null;
  });

  /** 命令校验错误（仅当 action=COMMAND 时生效）。 */
  readonly $commandError = computed<string | null>(() => {
    const btn = this.$selectedButton();
    if (!btn || btn.action !== ButtonAction.COMMAND) return null;
    const cmd = (btn.command ?? '').trim();
    if (!cmd) return '命令不能为空';
    if (!cmd.startsWith('/')) return '命令必须以 / 开头';
    return null;
  });

  /**
   * ENERGY_PACKAGE_GROUP 下当前已选 packageIds 的计算属性，传给 selector 做 input。
   * 非该 action 时返回空数组；selector 侧 agentId=null 时也不会加载。
   */
  readonly $packageIds = computed<number[]>(() => {
    const btn = this.$selectedButton();
    if (!btn || btn.action !== ButtonAction.ENERGY_PACKAGE_GROUP) return [];
    return btn.packageGroup?.packageIds ?? [];
  });

  /** 是否为"无配置" action（START / ADDRESS_MANAGE / WALLET_QUERY / ORDERS）。 */
  readonly $isNoConfigAction = computed<boolean>(() => {
    const btn = this.$selectedButton();
    if (!btn) return false;
    return (
      btn.action === ButtonAction.START ||
      btn.action === ButtonAction.ADDRESS_MANAGE ||
      btn.action === ButtonAction.WALLET_QUERY ||
      btn.action === ButtonAction.ORDERS
    );
  });

  /** 样式面板折叠状态——独立 signal，不持久化到 store。 */
  readonly $styleCollapsed = signal<boolean>(false);

  toggleStyleCollapse(): void {
    this.$styleCollapsed.update((v) => !v);
  }

  // ------------------------- 写操作 -------------------------

  updateText(value: string): void {
    const btn = this.$selectedButton();
    if (!btn) return;
    // 校验失败不阻止写入（UI 提示错误，保存时统一拦截）
    this.tree.updateButton(btn.id, { text: value });
  }

  /**
   * 切换 action：构造覆盖 patch——当前 action 相关字段保留（或用默认值兜底），
   * 其余特殊字段一律 `undefined` 覆盖以从按钮对象上"删除"。
   */
  updateAction(newAction: ButtonAction): void {
    const btn = this.$selectedButton();
    if (!btn) return;

    const patch: Partial<MenuButton> = {
      action: newAction,
      url: newAction === ButtonAction.URL ? (btn.url ?? '') : undefined,
      message: newAction === ButtonAction.TEXT ? (btn.message ?? '') : undefined,
      command:
        newAction === ButtonAction.COMMAND ? (btn.command ?? '/start') : undefined,
      submenu: newAction === ButtonAction.SUBMENU ? (btn.submenu ?? []) : undefined,
      packageGroup:
        newAction === ButtonAction.ENERGY_PACKAGE_GROUP
          ? (btn.packageGroup ?? {
              packageIds: [],
              sortBy: 'price_asc',
              textTemplate: '',
            })
          : undefined,
    };
    this.tree.updateButton(btn.id, patch);
  }

  updateURL(value: string): void {
    const btn = this.$selectedButton();
    if (!btn) return;
    this.tree.updateButton(btn.id, { url: value });
  }

  updateMessage(value: string): void {
    const btn = this.$selectedButton();
    if (!btn) return;
    this.tree.updateButton(btn.id, { message: value });
  }

  updateCommand(value: string): void {
    const btn = this.$selectedButton();
    if (!btn) return;
    this.tree.updateButton(btn.id, { command: value });
  }

  /**
   * 更新按钮样式。合并当前 style + patch，避免只改一个字段时丢失另一个。
   */
  updateStyle(patch: Partial<ButtonStyle>): void {
    const btn = this.$selectedButton();
    if (!btn) return;
    const nextStyle: ButtonStyle = { ...(btn.style ?? {}), ...patch };
    this.tree.updateButton(btn.id, { style: nextStyle });
  }

  // -------- ENERGY_PACKAGE_GROUP 专用 --------

  updatePackageGroupText(value: string): void {
    const btn = this.$selectedButton();
    if (!btn) return;
    this.tree.updateButton(btn.id, { packageGroupText: value });
  }

  /**
   * 来自 PackageGroupSelector 的 packageIdsChange。
   * 保留 sortBy / textTemplate，覆盖 packageIds。
   */
  updatePackageGroupIds(ids: number[]): void {
    this.patchPackageGroup({ packageIds: ids });
  }

  updatePackageGroupSortBy(value: PackageGroup['sortBy']): void {
    this.patchPackageGroup({ sortBy: value });
  }

  updatePackageGroupTemplate(value: string): void {
    this.patchPackageGroup({ textTemplate: value });
  }

  // -------- SUBMENU 专用 --------

  updateSubmenuText(value: string): void {
    const btn = this.$selectedButton();
    if (!btn) return;
    this.tree.updateButton(btn.id, { submenuText: value });
  }

  /** 进入子菜单：要求 action=SUBMENU。 */
  enterSubmenu(): void {
    const btn = this.$selectedButton();
    if (!btn || btn.action !== ButtonAction.SUBMENU) return;
    this.tree.enterSubmenu(btn.id);
  }

  /**
   * nz-color-picker 的 (nzOnChange) 事件回调：
   * 事件对象 { color, format }，color 需要转成 hex 字符串。
   * 我们用 color.toHexString() —— NzColor 提供该方法（从 tinycolor 继承）。
   * 若失败则回退 format+rgb 字符串。
   */
  onBgColorChange(event: { color: { toHexString(): string } }): void {
    const hex = this.safeToHex(event);
    if (hex == null) return;
    this.updateStyle({ bgColor: hex });
  }

  onTextColorChange(event: { color: { toHexString(): string } }): void {
    const hex = this.safeToHex(event);
    if (hex == null) return;
    this.updateStyle({ textColor: hex });
  }

  // ------------------------- 内部辅助 -------------------------

  /** 合并现有 packageGroup + patch 后写入。 */
  private patchPackageGroup(patch: Partial<PackageGroup>): void {
    const btn = this.$selectedButton();
    if (!btn) return;
    const base: PackageGroup = btn.packageGroup ?? {
      packageIds: [],
      sortBy: 'price_asc',
      textTemplate: '',
    };
    const nextGroup: PackageGroup = { ...base, ...patch };
    this.tree.updateButton(btn.id, { packageGroup: nextGroup });
  }

  /** 深度优先搜索整棵 root menu，找到 id 匹配的 button。 */
  private findButtonDeep(rows: MenuRow[], id: string): MenuButton | null {
    for (const row of rows) {
      for (const btn of row.buttons) {
        if (btn.id === id) return btn;
        if (btn.submenu && btn.submenu.length) {
          const nested = this.findButtonDeep(btn.submenu, id);
          if (nested) return nested;
        }
      }
    }
    return null;
  }

  private safeToHex(event: { color: { toHexString(): string } }): string | null {
    try {
      return event.color.toHexString();
    } catch {
      return null;
    }
  }
}
