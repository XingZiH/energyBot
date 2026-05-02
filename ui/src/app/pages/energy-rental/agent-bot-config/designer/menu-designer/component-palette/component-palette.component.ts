import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';

import { NzCardModule } from 'ng-zorro-antd/card';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ButtonAction } from '../../types';

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
   * 顺序即 UI 从上到下的展示顺序：按使用频率 / 逻辑分组排序——
   * 基础交互（URL/TEXT/COMMAND/START） → 结构（SUBMENU）→ 业务（能量/地址/钱包/订单）。
   *
   * ReadonlyArray + 每项 readonly 字段：运行期不可变，避免意外修改。
   */
  readonly paletteItems: ReadonlyArray<PaletteItem> = [
    {
      action: ButtonAction.URL,
      icon: 'link',
      title: '网址链接',
      description: '点击打开外部网址',
    },
    {
      action: ButtonAction.TEXT,
      icon: 'message',
      title: '文本消息',
      description: '点击回复一段文字',
    },
    {
      action: ButtonAction.COMMAND,
      icon: 'code',
      title: '命令',
      description: '执行 /xxx 命令',
    },
    {
      action: ButtonAction.START,
      icon: 'home',
      title: '开始',
      description: '返回欢迎界面',
    },
    {
      action: ButtonAction.SUBMENU,
      icon: 'folder',
      title: '子菜单',
      description: '下钻到下一级',
    },
    {
      action: ButtonAction.ENERGY_PACKAGE_GROUP,
      icon: 'thunderbolt',
      title: '能量套餐组',
      description: '展示套餐列表供选购',
    },
    {
      action: ButtonAction.ADDRESS_MANAGE,
      icon: 'environment',
      title: '地址管理',
      description: '打开地址管理面板',
    },
    {
      action: ButtonAction.WALLET_QUERY,
      icon: 'wallet',
      title: '钱包查询',
      description: '查询钱包链上数据',
    },
    {
      action: ButtonAction.ORDERS,
      icon: 'ordered-list',
      title: '我的订单',
      description: '展示用户订单列表',
    },
  ];

  /** *ngFor trackBy：避免每次变更检测时重建 DOM 节点 */
  trackByAction = (_: number, item: PaletteItem): string => item.action;
}
