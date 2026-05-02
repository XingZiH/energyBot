/**
 * render.ts 纯函数单元测试（任务 24）。
 *
 * 权威对齐：go-bot/internal/telegram/template/template.go（Render）
 * 及其 template_test.go 用例。任何行为差异都被视为前后端契约破裂。
 *
 * 覆盖维度：
 * - 基础替换：空串 / 无占位 / 单变量 / 多变量 / 相同变量多次 / 中文
 * - 未知变量：保留原样
 * - 转义：{{ / }} / {{name}} / 连续四个括号 / {{{name}}}
 * - 边界：孤立括号、空占位、非法标识符（数字开头 / 连字符 / 点 / 空格）
 * - 未闭合占位符
 * - 不递归
 * - segmentRendered 分段
 */
import { renderTemplate, segmentRendered, PreviewSegment } from './render';

describe('renderTemplate (前后端契约)', () => {
  // ---------- 基础替换 ----------

  it('1. 空字符串 → 空字符串', () => {
    expect(renderTemplate('', {})).toBe('');
  });

  it('2. 纯文本无占位 → 原样返回', () => {
    expect(renderTemplate('hello world', { name: 'x' })).toBe('hello world');
  });

  it('3. 单变量替换', () => {
    expect(renderTemplate('Hello {name}!', { name: 'World' })).toBe(
      'Hello World!',
    );
  });

  it('4. 多变量替换', () => {
    expect(renderTemplate('{a}-{b}', { a: '1', b: '2' })).toBe('1-2');
  });

  it('5. 相同变量多次出现全部替换', () => {
    expect(renderTemplate('{a}-{a}-{a}', { a: 'X' })).toBe('X-X-X');
  });

  it('6. 中文模板 + 英文变量值', () => {
    expect(
      renderTemplate('订单号：{orderNo} 已创建', { orderNo: 'ORD-2026-001' }),
    ).toBe('订单号：ORD-2026-001 已创建');
  });

  it('7. 中文变量值', () => {
    expect(
      renderTemplate('用户：{name}，状态：{status}', {
        name: '张三',
        status: '已付款',
      }),
    ).toBe('用户：张三，状态：已付款');
  });

  // ---------- 未知变量 ----------

  it('8. 未知变量保留原样', () => {
    expect(renderTemplate('{unknown}', {})).toBe('{unknown}');
  });

  it('9. 已知与未知混合', () => {
    expect(renderTemplate('{name}-{unknown}', { name: 'a' })).toBe(
      'a-{unknown}',
    );
  });

  // ---------- 转义 ----------

  it('10. 双左括号 → 字面 {', () => {
    expect(renderTemplate('{{', {})).toBe('{');
  });

  it('11. 双右括号 → 字面 }', () => {
    expect(renderTemplate('}}', {})).toBe('}');
  });

  it('12. 双括号包裹变量名视为字面', () => {
    expect(renderTemplate('{{name}}', { name: 'X' })).toBe('{name}');
  });

  it('13. 空双括号 → {}', () => {
    expect(renderTemplate('{{}}', {})).toBe('{}');
  });

  it('14. 三层括号：外层转义内层占位符', () => {
    // {{ -> { ; {name} -> X ; }} -> }
    expect(renderTemplate('值为 {{{name}}}', { name: 'X' })).toBe('值为 {X}');
  });

  it('15. 连续四个左括号转义为两个字面', () => {
    expect(renderTemplate('{{{{', {})).toBe('{{');
  });

  it('16. 转义与替换混合', () => {
    expect(
      renderTemplate('{{raw}} and {name}', { name: 'V', raw: 'R' }),
    ).toBe('{raw} and V');
  });

  // ---------- 边界 ----------

  it('17. 孤立左括号保留', () => {
    expect(renderTemplate('hello {', {})).toBe('hello {');
  });

  it('18. 孤立右括号保留', () => {
    expect(renderTemplate('hello }', {})).toBe('hello }');
  });

  it('19. 空占位不替换', () => {
    expect(renderTemplate('{}', { '': 'X' })).toBe('{}');
  });

  it('20. 非法标识符含点保留', () => {
    expect(renderTemplate('{a.b}', { 'a.b': 'X' })).toBe('{a.b}');
  });

  it('21. 非法标识符含连字符保留', () => {
    expect(renderTemplate('{a-b}', { 'a-b': 'X' })).toBe('{a-b}');
  });

  it('22. 非法标识符含空格保留', () => {
    expect(renderTemplate('{a b}', { 'a b': 'X' })).toBe('{a b}');
  });

  it('23. 数字开头标识符保留', () => {
    expect(renderTemplate('{1foo}', { '1foo': 'X' })).toBe('{1foo}');
  });

  it('24. 下划线开头合法', () => {
    expect(renderTemplate('{_foo}', { _foo: 'X' })).toBe('X');
  });

  it('25. 数字中间合法', () => {
    expect(renderTemplate('{foo1}', { foo1: 'X' })).toBe('X');
  });

  it('26. 未闭合的左括号保留', () => {
    expect(renderTemplate('{name', { name: 'X' })).toBe('{name');
  });

  it('27. 转义后跟孤立右括号：{{a} → {a}', () => {
    // {{ -> 字面 { ；随后 "a" 纯文本 ；"}" 是孤立右括号
    expect(renderTemplate('{{a}', {})).toBe('{a}');
  });

  // ---------- 不递归 ----------

  it('28. 变量值含占位符不递归替换', () => {
    expect(renderTemplate('{a}', { a: '{b}', b: 'X' })).toBe('{b}');
  });

  it('29. 变量值含双括号转义也不二次处理', () => {
    expect(renderTemplate('{a}', { a: '{{literal}}' })).toBe('{{literal}}');
  });
});

describe('segmentRendered 分段', () => {
  it('1. 空字符串 → 空段数组', () => {
    expect(segmentRendered('', {})).toEqual([]);
  });

  it('2. 纯文本 → 单个 text 段', () => {
    expect(segmentRendered('hello', {})).toEqual([
      { kind: 'text', content: 'hello' },
    ]);
  });

  it('3. 单变量（已知） → text + var + text', () => {
    const segs = segmentRendered('A {name} B', { name: 'X' });
    expect(segs).toEqual([
      { kind: 'text', content: 'A ' },
      { kind: 'var', content: 'X', varName: 'name' },
      { kind: 'text', content: ' B' },
    ]);
  });

  it('4. 未知变量 → unknown 段', () => {
    const segs = segmentRendered('{unknown}', {});
    expect(segs).toEqual([
      { kind: 'unknown', content: '{unknown}', varName: 'unknown' },
    ]);
  });

  it('5. 转义 {{ → escape 段', () => {
    const segs = segmentRendered('{{', {});
    expect(segs).toEqual([{ kind: 'escape', content: '{' }]);
  });

  it('6. 转义 }} → escape 段', () => {
    const segs = segmentRendered('}}', {});
    expect(segs).toEqual([{ kind: 'escape', content: '}' }]);
  });

  it('7. 孤立左括号归入 text', () => {
    expect(segmentRendered('hello {', {})).toEqual([
      { kind: 'text', content: 'hello {' },
    ]);
  });

  it('8. 混合场景顺序正确', () => {
    const segs = segmentRendered('A {{ {name} {unknown} }}', { name: 'V' });
    const expected: PreviewSegment[] = [
      { kind: 'text', content: 'A ' },
      { kind: 'escape', content: '{' },
      { kind: 'text', content: ' ' },
      { kind: 'var', content: 'V', varName: 'name' },
      { kind: 'text', content: ' ' },
      { kind: 'unknown', content: '{unknown}', varName: 'unknown' },
      { kind: 'text', content: ' ' },
      { kind: 'escape', content: '}' },
    ];
    expect(segs).toEqual(expected);
  });

  it('9. 非法标识符归入 text，整个 {...} 作字面', () => {
    // 与 renderTemplate 对齐：{a-b} 保留原样。分段时作为纯文本
    const segs = segmentRendered('{a-b}', {});
    // 逐字符：遇 `{`，后 `a` 合法标识符起点，后 `-` 失败 → `{` 归 text
    // 继续：`a`、`-`、`b`、`}` 都归 text（孤立 `}` 归 text）
    expect(segs).toEqual([{ kind: 'text', content: '{a-b}' }]);
  });

  it('10. 中文模板渲染', () => {
    const segs = segmentRendered('订单 {orderNo} 完成', { orderNo: 'O1' });
    expect(segs).toEqual([
      { kind: 'text', content: '订单 ' },
      { kind: 'var', content: 'O1', varName: 'orderNo' },
      { kind: 'text', content: ' 完成' },
    ]);
  });
});
