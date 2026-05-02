// Package template 提供简单的 {varName} 占位符替换引擎，
// 供 energybot 的消息模板（任务 12）和套餐组动态展开消费。
//
// 规则：
//   - {name} 替换为 variables[name]，未知变量保留原样 {name}（便于调试）
//   - {{ 转义为字面 {，}} 转义为字面 }
//   - 只识别合法 Go 标识符作为变量名：首字符为字母或下划线，后续字符为字母/数字/下划线
//   - 变量值中的 {other} 不递归替换（单次 rune 扫描，防注入）
//   - 孤立的 { 或 } 原样保留
//
// 设计决策：
//   - Render 不返回 error，容错设计——任何无法识别的片段一律原样保留
//   - 白名单 KnownVariables 只作为元数据导出，不在 Render 内强制校验
//     （由任务 23 的前端 VariableHint 和任务 12 的调用方按需消费）
//   - 使用 []rune 扫描保证 UTF-8 安全，中文模板可正常工作
package template

import (
	"strings"
	"unicode"
)

// KnownVariables 是业务变量白名单，对齐规格文档 docs/superpowers/specs/2026-05-02-bot-webui-designer.md 第 5.2 节。
// 顺序有意义：供 UI VariableHint 组件按约定顺序展示。
var KnownVariables = []string{
	"orderNo",     // Order.OrderNo
	"packageName", // Package.Name
	"amount",      // Order.Amount
	"energy",      // Package.Energy
	"address",     // Order.ReceiverAddress
	"payAddress",  // Order.PayAddress
	"txHash",      // Order.TxHash
	"botName",     // bot.Username
	"bandwidth",   // TRON API
	"balance",     // TRON API
	"reason",      // err.Error()
}

// knownVariablesSet 是 KnownVariables 的查表结构，供 IsKnownVariable 使用。
var knownVariablesSet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(KnownVariables))
	for _, name := range KnownVariables {
		m[name] = struct{}{}
	}
	return m
}()

// IsKnownVariable 检查变量名是否在业务白名单内。
// 区分大小写，零值字符串返回 false。
func IsKnownVariable(name string) bool {
	_, ok := knownVariablesSet[name]
	return ok
}

// Render 按规则渲染模板，详细规则见包注释。
// 当 variables 为 nil 时等价于空 map，所有占位符都会保留原样。
func Render(tpl string, variables map[string]string) string {
	if tpl == "" {
		return ""
	}
	runes := []rune(tpl)
	var b strings.Builder
	b.Grow(len(tpl))

	i := 0
	for i < len(runes) {
		c := runes[i]
		switch c {
		case '{':
			// 转义：{{ -> 字面 {
			if i+1 < len(runes) && runes[i+1] == '{' {
				b.WriteRune('{')
				i += 2
				continue
			}
			// 尝试匹配占位符 {identifier}
			if name, end, ok := tryReadPlaceholder(runes, i); ok {
				if val, hit := variables[name]; hit {
					b.WriteString(val)
				} else {
					// 未知变量保留原样，便于调试
					b.WriteString("{")
					b.WriteString(name)
					b.WriteString("}")
				}
				i = end
				continue
			}
			// 孤立的 { 或非法占位符，原样保留
			b.WriteRune('{')
			i++
		case '}':
			// 转义：}} -> 字面 }
			if i+1 < len(runes) && runes[i+1] == '}' {
				b.WriteRune('}')
				i += 2
				continue
			}
			// 孤立的 }，原样保留
			b.WriteRune('}')
			i++
		default:
			b.WriteRune(c)
			i++
		}
	}
	return b.String()
}

// tryReadPlaceholder 尝试从 runes[start] 开始读取一个 {identifier} 占位符。
// 要求 runes[start] == '{'。
// 返回变量名、占位符结束后的位置（即 '}' 后一位）、是否成功。
// 失败条件：标识符非法、未闭合、中途遇到非法字符。
func tryReadPlaceholder(runes []rune, start int) (name string, end int, ok bool) {
	// 跳过起始的 '{'
	j := start + 1
	if j >= len(runes) {
		return "", 0, false
	}
	// 首字符必须是字母或下划线
	if !isIdentStart(runes[j]) {
		return "", 0, false
	}
	nameStart := j
	j++
	// 后续字符允许字母/数字/下划线
	for j < len(runes) && isIdentPart(runes[j]) {
		j++
	}
	// 必须以 '}' 闭合
	if j >= len(runes) || runes[j] != '}' {
		return "", 0, false
	}
	return string(runes[nameStart:j]), j + 1, true
}

// isIdentStart 判断 r 是否为合法标识符首字符（字母或下划线）。
func isIdentStart(r rune) bool {
	return r == '_' || unicode.IsLetter(r)
}

// isIdentPart 判断 r 是否为合法标识符后续字符（字母/数字/下划线）。
func isIdentPart(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r)
}
