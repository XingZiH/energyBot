import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { MessageTemplates } from '../types';
import {
  AVAILABLE_VARIABLES,
  SCENE_METADATA,
  SceneMetadata,
  createEmptyTemplates,
} from './template-constants';

/**
 * MessageTemplateEditor —— 消息模板编辑器（任务 23）。
 *
 * 职责：
 * 1. 以左侧垂直 tab 的形式展示 9 个消息场景（{@link SCENE_METADATA}）。
 * 2. 每个场景内提供 textarea 编辑文案，并在顶部渲染 12 个可插入变量徽章
 *    （{@link AVAILABLE_VARIABLES}，与 go-bot KnownVariables 严格对齐）。
 * 3. 点击徽章将 `{name}` 占位插入到当前 textarea 光标位置。
 * 4. 实时校验文案中的未知变量，并在编辑区显示 nz-alert 警告。
 * 5. 通过 `templatesChange` output 向父组件广播最新草稿；父组件负责保存。
 *
 * 同步策略（与 PropertyPanel 保持一致）：
 * - 父 → 子：`initialTemplates` 变化时 effect 触发将深拷贝写入 `$draft`
 *   （`untracked` 防止 CD 循环）。
 * - 子 → 父：`updateScene`/`insertVariable` 修改 `$draft` 后立刻 emit。
 * - textarea 使用 `[ngModel] + (ngModelChange)` 单向+事件，避免 signal
 *   双向绑定的依赖环。
 *
 * 变量渲染规则与后端 `template.Render` 对齐：
 * - `{name}` 识别为占位符；`{{` `}}` 为转义（不算占位）。
 * - 变量名首字符必须是字母或下划线，后续可含字母/数字/下划线。
 */
@Component({
  selector: 'app-message-template-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzEmptyModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
    NzTabsModule,
    NzTagModule,
    NzTooltipModule,
  ],
  templateUrl: './message-template-editor.component.html',
  styleUrls: ['./message-template-editor.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageTemplateEditorComponent {
  /** 初始模板值——父组件传入，effect 会同步到 `$draft`。 */
  readonly initialTemplates = input.required<MessageTemplates>();

  /** 草稿变化通知——父组件监听并自行决定何时持久化。 */
  readonly templatesChange = output<MessageTemplates>();

  /** 当前激活的场景 key。默认第一个场景。 */
  readonly $activeScene = signal<keyof MessageTemplates>('welcome');

  /** 本地编辑中的模板草稿。initialTemplates 变化时 reset。 */
  readonly $draft = signal<MessageTemplates>(createEmptyTemplates());

  /** 9 个场景元数据（常量，直接模板引用）。 */
  readonly scenes: readonly SceneMetadata[] = SCENE_METADATA;

  /** 12 个可用变量元数据（常量，直接模板引用）。 */
  readonly availableVariables = AVAILABLE_VARIABLES;

  /** 已知变量名集合，校验用；从 availableVariables 派生一次即可。 */
  private readonly knownNames: ReadonlySet<string> = new Set(
    AVAILABLE_VARIABLES.map((v) => v.name),
  );

  /** 当前激活场景对应的 tab 索引，供 nz-tabs 的 nzSelectedIndex 绑定。 */
  readonly $activeTabIndex = computed<number>(() => {
    const key = this.$activeScene();
    const idx = this.scenes.findIndex((s) => s.key === key);
    return idx >= 0 ? idx : 0;
  });

  constructor() {
    // initialTemplates → $draft 同步。untracked 防止写操作被追踪而引发循环。
    effect(() => {
      const incoming = this.initialTemplates();
      untracked(() => {
        this.$draft.set({ ...incoming });
      });
    });
  }

  /** 根据 tab index 切换当前场景。 */
  onTabChange(index: number): void {
    const scene = this.scenes[index];
    if (scene) {
      this.$activeScene.set(scene.key);
    }
  }

  /**
   * 修改指定场景的文案，并立刻 emit 草稿给父组件。
   *
   * `updateScene` 是 textarea 编辑和变量插入的唯一写入路径；
   * 所有外部变更都必须经过这里，保证 emit 时序与 draft 一致。
   */
  updateScene(scene: keyof MessageTemplates, value: string): void {
    this.$draft.update((prev) => ({ ...prev, [scene]: value }));
    this.templatesChange.emit(this.$draft());
  }

  /**
   * 将 `{varName}` 插入到 textarea 的当前光标位置（或选中区间替换）。
   *
   * 光标处理：
   * 1. 读取 `selectionStart` / `selectionEnd`（不存在时退化为末尾插入）。
   * 2. 用 draft 当前值重组字符串，触发 `updateScene`。
   * 3. 用 `setTimeout(0)` 在微任务之后恢复焦点并把光标置于插入的字面量之后——
   *    必须延迟，因为 signal 写入 → ngModel 刷新是下一轮 CD。
   */
  insertVariable(
    scene: keyof MessageTemplates,
    varName: string,
    textarea: HTMLTextAreaElement,
  ): void {
    const placeholder = `{${varName}}`;
    const current = this.$draft()[scene] ?? '';
    const start =
      typeof textarea.selectionStart === 'number'
        ? textarea.selectionStart
        : current.length;
    const end =
      typeof textarea.selectionEnd === 'number'
        ? textarea.selectionEnd
        : current.length;

    const next = current.slice(0, start) + placeholder + current.slice(end);
    this.updateScene(scene, next);

    const caret = start + placeholder.length;
    // CD 周期结束后恢复焦点与光标
    setTimeout(() => {
      try {
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      } catch {
        // 非浏览器 DOM 环境下 setSelectionRange 可能抛错，忽略
      }
    });
  }

  /**
   * 返回指定场景文案中使用的**未知**变量名列表（无重复）。
   * 空字符串、纯转义文本或全部合法变量时返回空数组。
   */
  validateScene(scene: keyof MessageTemplates): string[] {
    const text = this.$draft()[scene] ?? '';
    if (!text) return [];
    const used = this.extractVariables(text);
    const unknown: string[] = [];
    const seen = new Set<string>();
    for (const name of used) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (!this.knownNames.has(name)) {
        unknown.push(name);
      }
    }
    return unknown;
  }

  /**
   * 扫描文本并提取所有合法变量占位的名字（含重复，顺序与出现顺序一致）。
   *
   * 与 go-bot `template.tryReadPlaceholder` 对齐：
   * - 首字符字母/下划线，后续字母/数字/下划线；
   * - `{{` 和 `}}` 为转义，不视为占位；
   * - 孤立的 `{` 或不合法标识符保留原样，忽略。
   */
  extractVariables(text: string): string[] {
    if (!text) return [];
    const names: string[] = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
      const c = text.charCodeAt(i);
      // 跳过 {{ 转义
      if (c === 0x7b /* { */ && text.charCodeAt(i + 1) === 0x7b) {
        i += 2;
        continue;
      }
      // 跳过 }} 转义
      if (c === 0x7d /* } */ && text.charCodeAt(i + 1) === 0x7d) {
        i += 2;
        continue;
      }
      if (c === 0x7b /* { */) {
        const parsed = this.readIdentifier(text, i + 1);
        if (parsed && text.charAt(parsed.end) === '}') {
          names.push(parsed.name);
          i = parsed.end + 1;
          continue;
        }
      }
      i++;
    }
    return names;
  }

  /**
   * 从 `text[start]` 开始尝试读取合法标识符。返回标识符字符串和末位索引
   * （指向标识符后第一个字符），失败返回 null。
   */
  private readIdentifier(
    text: string,
    start: number,
  ): { name: string; end: number } | null {
    if (start >= text.length) return null;
    const first = text.charAt(start);
    if (!/[A-Za-z_]/.test(first)) return null;
    let j = start + 1;
    while (j < text.length && /[A-Za-z0-9_]/.test(text.charAt(j))) {
      j++;
    }
    return { name: text.slice(start, j), end: j };
  }

  /** 某场景的已知变量计数——模板侧避免多次调用 validateScene 以外的一次。 */
  hasUnknownVariables(scene: keyof MessageTemplates): boolean {
    return this.validateScene(scene).length > 0;
  }

  /** trackBy 辅助。 */
  trackByName(_index: number, item: { name: string }): string {
    return item.name;
  }

  trackByKey(_index: number, item: SceneMetadata): string {
    return item.key;
  }
}
