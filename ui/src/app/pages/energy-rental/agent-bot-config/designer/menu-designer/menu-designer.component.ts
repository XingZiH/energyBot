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
import { FormsModule } from '@angular/forms';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { MenuRow } from '../types';
import { ComponentPaletteComponent } from './component-palette/component-palette.component';
import { MenuTreeService } from './menu-tree.service';
import { PropertyPanelComponent } from './property-panel/property-panel.component';
import { TelegramPreviewComponent } from './telegram-preview/telegram-preview.component';

/**
 * 设计器变更回传 payload。
 *
 * welcomeText + menuConfig 一次性提交，父组件直接透传给
 * UiConfigService.saveUiConfig，乐观锁走一次 PUT。
 */
export interface DesignerChange {
  welcomeText: string;
  menuConfig: MenuRow[];
}

/**
 * MenuDesigner 顶层容器（v2 重构，任务 31）。
 *
 * ## 布局（三栏）
 * 顶：welcomeText 输入 + 工具栏（保存 / 重置 / Undo / Redo + 脏态指示 + 校验 Alert）
 * 下：左 ComponentPalette（240）| 中 TelegramPreview（1fr，编辑即预览）| 右 PropertyPanel（320）
 *
 * 对比 v1：原 MenuCanvas 独立列被删，编辑入口并入 TelegramPreview。
 *
 * ## 状态管理
 * - MenuTreeService 本组件 providers 声明，子组件 inject 同一实例；
 *   $welcomeText / $rootMenu 都在 service 里，便于 undo/redo 统一处理。
 * - initialMenu / initialWelcomeText 变化触发 effect 重新 setRootMenu +
 *   setWelcomeText；$savedSnapshot 同步记录两者作为脏态基线。
 *
 * ## 保存
 * - 校验菜单深度通过后 emit DesignerChange（含 welcomeText + menuConfig）。
 * - 父组件一次 PUT 写入 ui-config。
 */
@Component({
  selector: 'app-menu-designer',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    FormsModule,
    ComponentPaletteComponent,
    PropertyPanelComponent,
    TelegramPreviewComponent,
    NzAlertModule,
    NzButtonModule,
    NzDividerModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
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
  /** 父容器传入的初始 welcomeText；与 menu 一起纳入脏态对比 */
  readonly initialWelcomeText = input<string>('');
  /** 当前 agent id，透传给 PropertyPanel（ENERGY_PACKAGE_GROUP 加载套餐时用） */
  readonly agentId = input<number | null>(null);

  /**
   * 保存成功时向父组件 emit 最新 welcomeText + menu 快照；
   * 父组件负责合并其他 UiConfig 字段后调用 API。
   */
  readonly designerChange = output<DesignerChange>();

  /** 最近一次"已保存/初始化"的菜单快照 */
  readonly $savedMenuSnapshot = signal<MenuRow[]>([]);
  /** 最近一次"已保存/初始化"的 welcomeText 快照 */
  readonly $savedWelcomeText = signal<string>('');

  /** 校验失败时的错误文案；null 表示无错误 */
  readonly $validationError = signal<string | null>(null);

  /** 保存进行中（当前立即 emit，保留 signal 供未来异步保存绑定 nzLoading） */
  readonly $saving = signal(false);

  /**
   * 脏态：菜单 JSON 或 welcomeText 任一不等于 snapshot 时为 true。
   */
  readonly $isDirty = computed(() => {
    const menuChanged =
      JSON.stringify(this.tree.$rootMenu()) !== JSON.stringify(this.$savedMenuSnapshot());
    const textChanged = this.tree.$welcomeText() !== this.$savedWelcomeText();
    return menuChanged || textChanged;
  });

  constructor() {
    effect(() => {
      // 依赖 2 个 input——任一变化都重新初始化
      const menu = this.initialMenu();
      const welcome = this.initialWelcomeText();
      const clonedMenu = structuredClone(menu);
      untracked(() => {
        this.tree.setRootMenu(clonedMenu);
        this.tree.setWelcomeText(welcome);
        this.$savedMenuSnapshot.set(structuredClone(clonedMenu));
        this.$savedWelcomeText.set(welcome);
        this.$validationError.set(null);
      });
    });
  }

  /**
   * welcomeText 输入框的双向绑定钩子。
   *
   * 每次按键直接 setWelcomeText（不进历史栈），保持打字流畅。
   * 用户 undo 时仅回滚菜单变更，不精确到某一次按键——与实际编辑体验匹配。
   */
  onWelcomeTextInput(value: string): void {
    this.tree.setWelcomeText(value);
  }

  /**
   * 失去焦点时把当前 welcomeText 以"一步"进历史栈，支持 undo 到输入前的值。
   */
  onWelcomeTextBlur(): void {
    // setWelcomeTextWithHistory 内部判同值跳过
    this.tree.setWelcomeTextWithHistory(this.tree.$welcomeText());
  }

  /**
   * 校验菜单深度 + emit 新快照。校验失败不 emit。
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
    const menuSnap = structuredClone(this.tree.$rootMenu());
    const textSnap = this.tree.$welcomeText();
    this.$savedMenuSnapshot.set(menuSnap);
    this.$savedWelcomeText.set(textSnap);
    this.designerChange.emit({ welcomeText: textSnap, menuConfig: menuSnap });
  }

  /**
   * 确认后恢复到最近 snapshot；清空校验错误。直接 setRootMenu 也会清空 undo/redo
   * 历史栈——这符合"重置 = 放弃所有未保存改动"的用户预期。
   */
  reset(): void {
    this.modal.confirm({
      nzTitle: '重置菜单',
      nzContent: '将丢弃所有未保存的修改，恢复到最近保存状态。确定继续？',
      nzOkText: '确定',
      nzCancelText: '取消',
      nzOnOk: () => {
        this.tree.setRootMenu(structuredClone(this.$savedMenuSnapshot()));
        this.tree.setWelcomeText(this.$savedWelcomeText());
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
