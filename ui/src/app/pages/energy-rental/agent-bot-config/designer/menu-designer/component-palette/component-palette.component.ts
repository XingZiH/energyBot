import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';

import { NzCardModule } from 'ng-zorro-antd/card';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ButtonAction } from '../../types';
import { ACTION_ICON_MAP, ACTION_TITLE_MAP } from '../action-icons';

/**
 * 组件面板一项的数据结构。
 *
 * 作为 cdkDragData 传递到 MenuCanvas（任务 16）——canvas 在 drop 回调里读取 action，
 * 初始化对应类型的空按钮。
 */
export interface PaletteItem {
  /** 拖拽后创建的按钮 action 类型 */
  action: ButtonAction;
  /** ng-zorro 图标名（outline 主题） */
  icon: string;
  /** 卡片主标题（中文） */
  title: string;
  /** 卡片描述 + tooltip 内容 */
  description: string;
}

/**
 * description 描述文案（仅 palette 使用，按 action 分散到此 map）。
 *
 * 未放入 action-icons.ts 的原因：canvas 卡片展示 text 由用户编辑，
 * 不需要 palette 的引导文案；提取到共享文件反而扩大无必要的依赖。
 */
const PALETTE_DESCRIPTION_MAP: Record<ButtonAction, string> = {
  [ButtonAction.URL]: '点击打开外部网址',
  [ButtonAction.TEXT]: '点击回复一段文字',
  [ButtonAction.COMMAND]: '执行 /xxx 命令',
  [ButtonAction.START]: '返回欢迎界面',
  [ButtonAction.SUBMENU]: '下钻到下一级',
  [ButtonAction.ENERGY_PACKAGE_GROUP]: '展示套餐列表供选购',
  [ButtonAction.ADDRESS_MANAGE]: '打开地址管理面板',
  [ButtonAction.WALLET_QUERY]: '查询钱包链上数据',
  [ButtonAction.ORDERS]: '展示用户订单列表',
};

/**
 * paletteItems 展示顺序：
 * 基础交互（URL/TEXT/COMMAND/START）→ 结构（SUBMENU）→ 业务（能量/地址/钱包/订单）。
 *
 * 按频率/逻辑分组排列，而不是 enum 声明序，改动 enum 声明序不影响 UI。
 */
const PALETTE_DISPLAY_ORDER: ReadonlyArray<ButtonAction> = [
  ButtonAction.URL,
  ButtonAction.TEXT,
  ButtonAction.COMMAND,
  ButtonAction.START,
  ButtonAction.SUBMENU,
  ButtonAction.ENERGY_PACKAGE_GROUP,
  ButtonAction.ADDRESS_MANAGE,
  ButtonAction.WALLET_QUERY,
  ButtonAction.ORDERS,
];

/**
 * 左侧组件面板：列出 9 种可拖拽到画布的按钮类型。
 *
 * 职责：
 * - 纯拖拽源（不接入状态管理 service）
 * - 数据静态，OnPush 即可
 * - 通过 cdkDropListGroup 与 canvas 的 dropList 组成拖拽目标组
 */
@Component({
  selector: 'app-component-palette',
  standalone: true,
  imports: [CommonModule, DragDropModule, NzIconModule, NzCardModule, NzTooltipModule],
  templateUrl: './component-palette.component.html',
  styleUrls: ['./component-palette.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComponentPaletteComponent {
  /**
   * 9 种 action 对应的 palette 项。
   *
   * 顺序由 PALETTE_DISPLAY_ORDER 控制；图标 + 标题从 action-icons.ts 的共享 map 读取，
   * 避免 palette 与 canvas 两端维护两份（新增 enum 值时 TS 会强制补齐 map）。
   *
   * ReadonlyArray + 每项 readonly 字段：运行期不可变，避免意外修改。
   */
  readonly paletteItems: ReadonlyArray<PaletteItem> = PALETTE_DISPLAY_ORDER.map((action) => ({
    action,
    icon: ACTION_ICON_MAP[action],
    title: ACTION_TITLE_MAP[action],
    description: PALETTE_DESCRIPTION_MAP[action],
  }));

  /** *ngFor trackBy：避免每次变更检测时重建 DOM 节点 */
  trackByAction = (_: number, item: PaletteItem): string => item.action;
}
