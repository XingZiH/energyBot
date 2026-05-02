#!/usr/bin/env node
/**
 * Designer 主题颜色审计脚本（任务 21）
 *
 * 设计文档 §8.2 要求：所有 designer 组件严格使用 ng-zorro `--ant-color-*` CSS
 * 变量；唯一例外是 TelegramPreview 的 Telegram 官方配色。
 *
 * 本脚本递归扫描 designer 目录（排除 telegram-preview/）下的所有 .less，
 * 将硬编码颜色（hex / rgb / rgba）标记为违规，但放行以下合法情形：
 *
 *   1. 写在 `var(--ant-*, fallback)` 内部的 fallback 色——降级兜底，合法；
 *   2. 纯黑/纯白 alpha 叠加——`rgba(0,0,0,x)` / `rgba(255,255,255,x)`，
 *      投影/聚焦环等与主题无关的视觉层，合法；
 *   3. 出现在单行或块注释里的颜色字面量——非实际样式，忽略。
 *
 * 使用：
 *   node scripts/audit-designer-theme.mjs
 *   → 违规时退出码 1 并打印清单；无违规时退出码 0。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(SCRIPT_DIR, '..');
const DESIGNER_ROOT = resolve(
  UI_ROOT,
  'src/app/pages/energy-rental/agent-bot-config/designer'
);
const EXCLUDE_DIRS = new Set(['telegram-preview']);

/** 递归收集所有 .less 文件（排除 telegram-preview/）。 */
function collectLessFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      collectLessFiles(full, out);
    } else if (entry.endsWith('.less')) {
      out.push(full);
    }
  }
  return out;
}

// 颜色字面量：#rgb/#rgba/#rrggbb/#rrggbbaa，以及 rgb(/rgba( 开头
const COLOR_PATTERN = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|\brgb\(|\brgba\(/;
// 允许的纯黑/纯白 alpha：rgba( 0|255 , 0|255 , 0|255 , 数 )
const ALLOWED_ALPHA = /rgba\(\s*(0|255)\s*,\s*(0|255)\s*,\s*(0|255)\s*,\s*[0-9.]+\s*\)/;

function audit() {
  const files = collectLessFiles(DESIGNER_ROOT);
  const violations = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf-8');
    // 先剥离 /* ... */ 块注释（保留换行以便行号一致）
    const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, (match) =>
      match.replace(/[^\n]/g, ' ')
    );

    noBlock.split('\n').forEach((rawLine, idx) => {
      // 剥离 // 行尾注释
      const line = rawLine.replace(/\/\/.*$/, '');
      if (!COLOR_PATTERN.test(line)) return;
      // 剥离 var(...) 内部的 fallback 再检查
      const stripped = line.replace(/var\([^)]*\)/g, '');
      if (!COLOR_PATTERN.test(stripped)) return;
      // 纯黑/纯白 alpha 允许
      if (ALLOWED_ALPHA.test(line)) return;
      violations.push({
        file: relative(UI_ROOT, file),
        line: idx + 1,
        text: line.trim(),
      });
    });
  }

  return { files, violations };
}

const { files, violations } = audit();

if (violations.length > 0) {
  console.error(
    `\u274c designer 主题审计失败：发现 ${violations.length} 处硬编码颜色违规\n`
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error(
    '\n修复建议：用 var(--ant-color-*) 替换硬编码颜色；确需兜底时写成 var(--ant-color-*, #fallback)。'
  );
  process.exit(1);
}

console.log(
  `\u2705 designer 主题审计通过（扫描 ${files.length} 个 .less 文件，0 处违规）。`
);
