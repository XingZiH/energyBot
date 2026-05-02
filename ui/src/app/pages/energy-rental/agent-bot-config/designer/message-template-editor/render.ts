/**
 * 模板渲染引擎（任务 24）。
 *
 * ⚠️ 权威源对齐：此文件的行为必须与 go-bot 后端渲染严格一致。
 *   - 后端源：go-bot/internal/telegram/template/template.go `Render`
 *   - 后端测试：go-bot/internal/telegram/template/template_test.go
 *
 * 任何偏离都会导致 UI 预览与 bot 实际推送结果不一致。修改前请同步
 * 更新后端实现与测试，并确保 render.spec.ts 全绿。
 *
 * 规则：
 *   1. `{name}` 若 name 为合法标识符且在 variables 字典中，替换为字典值；
 *      不在字典中则保留原样 `{name}`（便于调试未知占位）。
 *   2. `{{` 转义为字面 `{`，`}}` 转义为字面 `}`。
 *   3. 合法标识符：首字符字母/下划线，后续字符字母/数字/下划线。
 *      注意：go-bot 用 `unicode.IsLetter`，会接纳非 ASCII 字母（如中文）；
 *      本模块按业务需求保守采用 ASCII 字母（前端 variable 提示也只支持 ASCII）。
 *      业务上不存在"中文变量名"，因此差异在实际场景下不可见。
 *   4. 孤立的 `{` 或 `}`、以及无法识别的占位（如 `{a-b}`、`{1x}`、未闭合 `{name`）
 *      原样保留。
 *   5. 不递归：变量值中的 `{other}` / `{{escape}}` 不再进行第二遍处理。
 */

/** 预览分段——供高亮 UI 使用。 */
export type PreviewSegment =
  | { kind: 'text'; content: string }
  | { kind: 'var'; content: string; varName: string }
  | { kind: 'unknown'; content: string; varName: string }
  | { kind: 'escape'; content: string };

/** 合法标识符首字符（ASCII 字母或下划线）。 */
function isIdentStart(ch: string): boolean {
  return /^[A-Za-z_]$/.test(ch);
}

/** 合法标识符后续字符（ASCII 字母/数字/下划线）。 */
function isIdentPart(ch: string): boolean {
  return /^[A-Za-z0-9_]$/.test(ch);
}

/**
 * 尝试从 text[start] 处读取 `{identifier}` 占位符，其中 text[start] === '{'。
 * 成功返回 `{ name, end }`，end 指向 `}` 之后；失败返回 null。
 *
 * 与 go-bot `tryReadPlaceholder` 逻辑严格对齐：逐字符扫描，中途遇到
 * 非标识符字符立即失败（不会跳到下一个 `}`）。
 */
function tryReadPlaceholder(
  text: string,
  start: number,
): { name: string; end: number } | null {
  let j = start + 1; // 跳过 '{'
  if (j >= text.length) return null;
  if (!isIdentStart(text.charAt(j))) return null;
  const nameStart = j;
  j++;
  while (j < text.length && isIdentPart(text.charAt(j))) {
    j++;
  }
  if (j >= text.length || text.charAt(j) !== '}') return null;
  return { name: text.slice(nameStart, j), end: j + 1 };
}

/**
 * 渲染模板，未知变量保留原样占位。
 *
 * @param template 模板文本
 * @param variables 变量字典（key 为变量名）
 * @returns 渲染后的文本
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  if (!template) return '';
  let result = '';
  const n = template.length;
  let i = 0;
  while (i < n) {
    const ch = template.charAt(i);
    if (ch === '{') {
      // {{ 转义
      if (i + 1 < n && template.charAt(i + 1) === '{') {
        result += '{';
        i += 2;
        continue;
      }
      // 尝试匹配 {identifier}
      const parsed = tryReadPlaceholder(template, i);
      if (parsed) {
        if (Object.prototype.hasOwnProperty.call(variables, parsed.name)) {
          result += variables[parsed.name];
        } else {
          result += '{' + parsed.name + '}';
        }
        i = parsed.end;
        continue;
      }
      // 孤立 { 或非法占位
      result += '{';
      i++;
    } else if (ch === '}') {
      if (i + 1 < n && template.charAt(i + 1) === '}') {
        result += '}';
        i += 2;
        continue;
      }
      result += '}';
      i++;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

/**
 * 分段渲染：保留「纯文本 / 变量值 / 未知变量 / 转义括号」的结构，
 * 供 UI 按段落应用不同的高亮样式。
 *
 * 规则与 {@link renderTemplate} 完全一致，但保留语义分段；纯文本、
 * 孤立括号、非法占位均合并为 text 段（相邻的 text 段会合并为一个）。
 */
export function segmentRendered(
  template: string,
  variables: Record<string, string>,
): PreviewSegment[] {
  const segments: PreviewSegment[] = [];
  let textBuffer = '';
  const flushText = (): void => {
    if (textBuffer) {
      segments.push({ kind: 'text', content: textBuffer });
      textBuffer = '';
    }
  };

  if (!template) return segments;
  const n = template.length;
  let i = 0;
  while (i < n) {
    const ch = template.charAt(i);
    if (ch === '{') {
      if (i + 1 < n && template.charAt(i + 1) === '{') {
        flushText();
        segments.push({ kind: 'escape', content: '{' });
        i += 2;
        continue;
      }
      const parsed = tryReadPlaceholder(template, i);
      if (parsed) {
        flushText();
        if (Object.prototype.hasOwnProperty.call(variables, parsed.name)) {
          segments.push({
            kind: 'var',
            content: variables[parsed.name],
            varName: parsed.name,
          });
        } else {
          segments.push({
            kind: 'unknown',
            content: '{' + parsed.name + '}',
            varName: parsed.name,
          });
        }
        i = parsed.end;
        continue;
      }
      textBuffer += '{';
      i++;
    } else if (ch === '}') {
      if (i + 1 < n && template.charAt(i + 1) === '}') {
        flushText();
        segments.push({ kind: 'escape', content: '}' });
        i += 2;
        continue;
      }
      textBuffer += '}';
      i++;
    } else {
      textBuffer += ch;
      i++;
    }
  }
  flushText();
  return segments;
}
