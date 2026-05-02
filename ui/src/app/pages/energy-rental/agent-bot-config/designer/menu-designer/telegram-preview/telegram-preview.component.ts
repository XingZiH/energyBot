import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { NzIconModule } from 'ng-zorro-antd/icon';

import { ButtonAction, MenuButton, MenuRow } from '../../types';
import { MenuTreeService } from '../menu-tree.service';

/**
 * TelegramPreview（任务 19）。
 *
 * 右侧固定区域，模拟 Telegram 聊天界面，实时预览当前菜单层级的按钮布局：
 * - 根菜单（breadcrumb.length === 1） → Reply Keyboard 样式
 * - 子菜单（breadcrumb.length > 1）    → Inline Keyboard 样式
 * - 空菜单 → 仅显示一条 bot 气泡占位
 * - SUBMENU 按钮右侧显示"▸"下钻箭头
 *
 * 主题：明/暗两套颜色**硬编码**——本项目唯一允许硬编码配色的组件，
 * 详见 .less 顶部注释（设计文档 §8.2 例外说明）。与系统 ng-zorro 主题独立，
 * 由 $darkMode 信号手动切换。
 */
@Component({
  selector: 'app-telegram-preview',
  standalone: true,
  imports: [CommonModule, NzIconModule],
  templateUrl: './telegram-preview.component.html',
  styleUrls: ['./telegram-preview.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelegramPreviewComponent {
  readonly tree = inject(MenuTreeService);

  readonly $currentMenu = this.tree.$currentMenu;
  readonly $breadcrumb = this.tree.$breadcrumb;

  /** 明/暗主题预览切换（独立于系统主题） */
  readonly $darkMode = signal(false);

  /**
   * 约定：根层用 Reply Keyboard，子层用 Inline Keyboard。
   * 与实际 Telegram Bot 常见模式一致：主菜单常驻底部键盘，子菜单则随消息 inline。
   */
  readonly $isInline = computed(() => this.$breadcrumb().length > 1);

  /** 暴露给模板的枚举引用 */
  readonly ButtonAction = ButtonAction;

  toggleDarkMode(): void {
    this.$darkMode.update((v) => !v);
  }

  /**
   * 面包屑拼接字符串，供底部小字"当前预览层级：…"使用。
   */
  readonly $breadcrumbText = computed(() =>
    this.$breadcrumb()
      .map((c) => c.label)
      .join(' > '),
  );

  getButtonTooltip(btn: MenuButton): string {
    // 简短提示：按钮文本 + action 类型，便于管理员定位
    return `${btn.text || '(未命名)'} · ${btn.action}`;
  }

  trackByRowId = (_: number, row: MenuRow): string => row.id;
  trackByButtonId = (_: number, btn: MenuButton): string => btn.id;
}
