import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { AVAILABLE_VARIABLES } from './template-constants';
import { renderTemplate, segmentRendered } from './render';

/**
 * TemplatePreviewComponent —— 消息模板实时预览（任务 24）。
 *
 * 职责：
 * 1. 接收模板文本 + 变量字典，实时渲染预览结果。
 * 2. 未提供 variables 时使用 {@link AVAILABLE_VARIABLES} 的 example 作为默认样例值，
 *    让用户在编辑器中立即看到可读的替换效果。
 * 3. 对已识别 / 未识别的变量、以及转义括号做分段高亮，供设计时调试。
 *
 * 设计要点：
 * - 所有渲染逻辑通过纯函数 {@link renderTemplate} / {@link segmentRendered} 完成，
 *   严格对齐 go-bot/internal/telegram/template/template.go。
 * - `mergedVariables` 单向合并：外部输入覆盖默认 example，但不修改默认字典。
 * - OnPush + computed，template / variables 任一 input 变化即触发最小重渲染。
 */
@Component({
  selector: 'app-template-preview',
  standalone: true,
  imports: [CommonModule, NzEmptyModule, NzIconModule, NzTooltipModule],
  templateUrl: './template-preview.component.html',
  styleUrls: ['./template-preview.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatePreviewComponent {
  /** 要预览的模板字符串（含 `{varName}` 占位）。 */
  readonly template = input.required<string>();

  /** 变量字典——覆盖默认样例值。例如 `{ orderNo: 'ORD001' }`。 */
  readonly variables = input<Record<string, string>>({});

  /** 是否显示底部图例（变量值 / 未知变量 / 转义）。 */
  readonly showLegend = input<boolean>(true);

  /**
   * 合并后的变量字典：先使用 AVAILABLE_VARIABLES 默认 example，再被 variables input 覆盖。
   * 输出保留 input 以外的任意额外 key（测试场景可能注入 KnownVariables 之外的 key）。
   */
  readonly $mergedVariables = computed<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const v of AVAILABLE_VARIABLES) {
      defaults[v.name] = v.example;
    }
    return { ...defaults, ...this.variables() };
  });

  /** 分段结构（供模板 @switch 渲染），也能作为 UI 测试断言入口。 */
  readonly $segments = computed(() =>
    segmentRendered(this.template(), this.$mergedVariables()),
  );

  /** 渲染后的纯文本（不含分段标记），便于外部复制或调试。 */
  readonly $rendered = computed(() =>
    renderTemplate(this.template(), this.$mergedVariables()),
  );

  /** 模板为空或仅含空白视为空——空态使用 nz-empty 提示。 */
  readonly $isEmpty = computed(() => this.template().trim().length === 0);
}
