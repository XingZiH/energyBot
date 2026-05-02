import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { MenuRow } from '../types';
import { ComponentPaletteComponent } from './component-palette/component-palette.component';
import { MenuCanvasComponent } from './menu-canvas/menu-canvas.component';
import { MenuTreeService } from './menu-tree.service';
import { PropertyPanelComponent } from './property-panel/property-panel.component';
import { TelegramPreviewComponent } from './telegram-preview/telegram-preview.component';

/**
 * MenuDesigner 顶层容器（任务 20）。
 *
 * 组装四栏布局：
 * - 左：ComponentPalette（拖拽源，240px）
 * - 中：MenuCanvas（画布，flex: 1）
 * - 右：PropertyPanel（属性编辑，320px）
 * - 最右：TelegramPreview（预览，360px）
 *
 * 工具栏：保存 / 重置 / Undo / Redo + 脏态指示 + 校验错误 Alert。
 *
 * 状态管理：
 * - MenuTreeService 在本组件 providers 中声明，4 个子组件 inject 到同一实例。
 * - initialMenu input 变化时 effect 触发 setRootMenu，同步更新 $savedSnapshot
 *   作为脏态对比基线和 reset 恢复目标。
 * - $isDirty 通过 JSON.stringify 比较当前 rootMenu 与 snapshot。
 * - save：validateDepth 通过后深拷贝快照、emit menuChange、清空 $validationError。
 *   失败时设 $validationError 不 emit。
 * - reset：通过 NzModalService.confirm 二次确认，OK 后从 snapshot 深拷贝恢复。
 *
 * 职责边界：
 * - 本组件只负责本地状态 + UI 协调，不调后端 API；保存由父容器（agent-bot-config）
 *   监听 menuChange 后自行发起请求（任务 22）。
 *
 * 拖拽：
 * - 根容器挂 cdkDropListGroup：ComponentPalette 的 cdkDrag（无 list）本就可自由
 *   拖入 MenuCanvas 的任意 cdkDropList；group 在此作为显式语义标记，
 *   同时允许未来子组件间的 drop list 相互联通。
 */
@Component({
  selector: 'app-menu-designer',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    ComponentPaletteComponent,
    MenuCanvasComponent,
    PropertyPanelComponent,
    TelegramPreviewComponent,
    NzAlertModule,
    NzButtonModule,
    NzDividerModule,
    NzIconModule,
    NzTooltipModule,
  ],
  providers: [MenuTreeService],
  templateUrl: './menu-designer.component.html',
  styleUrls: ['./menu-designer.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuDesignerComponent {
  readonly tree = inject(MenuTreeService);
  private readonly modal = inject(NzModalService);

  /** 父容器传入的初始菜单；变更时重新 setRootMenu + 更新 snapshot */
  readonly initialMenu = input<MenuRow[]>([]);
  /** 当前 agent id，透传给 PropertyPanel（ENERGY_PACKAGE_GROUP 加载套餐时用） */
  readonly agentId = input<number | null>(null);

  /** 保存成功时向父组件 emit 最新 menu 快照；父组件负责 API 调用 */
  readonly menuChange = output<MenuRow[]>();

  /** 最近一次"已保存/初始化"的快照，reset 恢复目标、$isDirty 比较基线 */
  readonly $savedSnapshot = signal<MenuRow[]>([]);

  /** 校验失败时的错误文案；null 表示无错误 */
  readonly $validationError = signal<string | null>(null);

  /**
   * 保存进行中状态。当前 save() 纯本地校验 + emit，立即完成；保留 signal
   * 是为了模板上的 nzLoading 能直接绑定，未来父组件异步保存时可通过外部 input
   * 或内部扩展驱动。
   */
  readonly $saving = signal(false);

  /**
   * 脏态：当前 rootMenu 与 snapshot 的 JSON 序列化结果不等。
   *
   * 深比较没有用到 lodash 一是项目已禁止引入；二是菜单结构有限制
   * （MAX_ROWS_PER_MENU=8、MAX_BUTTONS_PER_ROW=4、MAX_MENU_DEPTH=3），
   * JSON.stringify 的 O(n) 开销完全可接受。
   */
  readonly $isDirty = computed(() => {
    return JSON.stringify(this.tree.$rootMenu()) !== JSON.stringify(this.$savedSnapshot());
  });

  constructor() {
    effect(() => {
      const menu = this.initialMenu();
      // 深拷贝隔离父组件引用，避免 setRootMenu 后对原数组的外部修改污染内部状态。
      // untracked 包裹写操作，防止被 effect 依赖追踪（写入的 signal 同时被其他
      // computed 读取，不包裹会触发额外 CD 循环，并在 OnPush + dev-mode 下
      // 误报 ExpressionChangedAfterItHasBeenCheckedError）。
      const cloned = structuredClone(menu);
      untracked(() => {
        this.tree.setRootMenu(cloned);
        this.$savedSnapshot.set(structuredClone(cloned));
        this.$validationError.set(null);
      });
    });
  }

  /**
   * 校验菜单深度 + emit 最新快照 + 更新 snapshot。
   *
   * - 校验失败：$validationError 写入错误文案，**不** emit。
   * - 校验通过：深拷贝 rootMenu 作为新 snapshot（使 $isDirty 归 false），
   *   然后 emit 给父组件；不做任何 API 调用（由父组件处理）。
   */
  save(): void {
    try {
      this.tree.validateDepth(this.tree.$rootMenu());
    } catch (err) {
      const msg = err instanceof Error ? err.message : '菜单校验失败';
      this.$validationError.set(msg);
      return;
    }
    this.$validationError.set(null);
    const snapshot = structuredClone(this.tree.$rootMenu());
    this.$savedSnapshot.set(snapshot);
    this.menuChange.emit(snapshot);
  }

  /**
   * 弹窗确认后恢复到最近保存的 snapshot；同时清空校验错误。
   *
   * 注意：直接 setRootMenu 会清空 undo/redo 历史；这符合用户对"重置"的预期——
   * 放弃所有未保存变更，包括可撤销栈。
   */
  reset(): void {
    this.modal.confirm({
      nzTitle: '重置菜单',
      nzContent: '将丢弃所有未保存的修改，恢复到最近保存状态。确定继续？',
      nzOkText: '确定',
      nzCancelText: '取消',
      nzOnOk: () => {
        this.tree.setRootMenu(structuredClone(this.$savedSnapshot()));
        this.$validationError.set(null);
      },
    });
  }

  undo(): void {
    this.tree.undo();
  }

  redo(): void {
    this.tree.redo();
  }
}
