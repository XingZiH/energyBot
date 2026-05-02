// Package telegram 的 designer.go 提供设计器 v2 的数据结构和解析逻辑。
//
// v2 路径概述：
//   - 菜单解析：parseMenuRowsV2（严格 JSON + 深度校验），唯一调用方为 bot.go:loadDesignerConfig；
//   - 按钮分发：统一走 actions.Dispatcher（见 internal/telegram/actions/），按钮 action 字符串
//     对应 ButtonAction 枚举（9 种）；
//   - v1 遗留的 parseMenuRows / executeDesignerButton 已在任务 10D 清理。
//
// 修改本文件的字段或 JSON tag 时，务必同步更新：
//   - 前端：ui/src/app/pages/energy-rental/agent-bot-config/designer/types.ts
//   - NestJS：nest-api/src/modules/energy-rental/dto/ui-config.dto.ts
package telegram

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// MaxMenuDepth 是菜单允许的最大嵌套深度（根菜单 + 2 层 submenu）。
// 该值与前端 MAX_MENU_DEPTH、NestJS 深度校验保持一致。
const MaxMenuDepth = 3

// ButtonAction 表示设计器 v2 按钮的行为类型。
// 常量字符串值与前端 types.ts 的 ButtonAction 枚举保持一致。
type ButtonAction string

const (
	ActionURL                ButtonAction = "url"
	ActionText               ButtonAction = "text"
	ActionCommand            ButtonAction = "command"
	ActionStart              ButtonAction = "start"
	ActionSubmenu            ButtonAction = "submenu"
	ActionEnergyPackageGroup ButtonAction = "energy_package_group"
	ActionAddressManage      ButtonAction = "address_manage"
	ActionWalletQuery        ButtonAction = "wallet_query"
	ActionOrders             ButtonAction = "orders"
)

// validActions 用于校验传入的 action 字符串是否属于已知枚举。
var validActions = map[ButtonAction]struct{}{
	ActionURL:                {},
	ActionText:               {},
	ActionCommand:            {},
	ActionStart:              {},
	ActionSubmenu:            {},
	ActionEnergyPackageGroup: {},
	ActionAddressManage:      {},
	ActionWalletQuery:        {},
	ActionOrders:             {},
}

// MessageTemplates 是设计器 v2 的消息模板集合，字段名与前端 camelCase 对齐。
type MessageTemplates struct {
	Welcome            string `json:"welcome"`
	OrderCreated       string `json:"orderCreated"`
	PayPending         string `json:"payPending"`
	PaySuccess         string `json:"paySuccess"`
	PayFailed          string `json:"payFailed"`
	AddressInvalid     string `json:"addressInvalid"`
	UnknownCommand     string `json:"unknownCommand"`
	PackageUnavailable string `json:"packageUnavailable"`
	WalletQueryResult  string `json:"walletQueryResult"`
}

// PackageGroupConfig 描述一个"套餐组"按钮的展开规则。
type PackageGroupConfig struct {
	PackageIDs   []int  `json:"packageIds"`
	SortBy       string `json:"sortBy"`
	TextTemplate string `json:"textTemplate"`
}

// ButtonStyle 控制按钮的视觉样式（颜色等）。
type ButtonStyle struct {
	BgColor   string `json:"bgColor,omitempty"`
	TextColor string `json:"textColor,omitempty"`
}

// parseMenuRowsV2 解析新版嵌套菜单结构。
// 空串或字面量 "null" 视为无菜单，返回 nil rows 且无错误。
func parseMenuRowsV2(raw string) ([]DesignerMenuRow, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return nil, nil
	}
	var rows []DesignerMenuRow
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		return nil, fmt.Errorf("menu_config 非法 JSON: %w", err)
	}
	if err := validateMenuRows(rows, 1, MaxMenuDepth); err != nil {
		return nil, err
	}
	return rows, nil
}

// validateMenuRows 递归校验菜单节点：动作合法且嵌套深度不超过 maxDepth。
func validateMenuRows(rows []DesignerMenuRow, depth, maxDepth int) error {
	if depth > maxDepth {
		return fmt.Errorf("菜单嵌套深度超过 %d 层", maxDepth)
	}
	for _, row := range rows {
		for _, btn := range row.Buttons {
			if _, ok := validActions[btn.Action]; !ok {
				return fmt.Errorf("未知 action: %q", btn.Action)
			}
			if btn.Action == ActionSubmenu && len(btn.Submenu) > 0 {
				if err := validateMenuRows(btn.Submenu, depth+1, maxDepth); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// parseMessageTemplates 解析 message_config JSON 为结构化的 MessageTemplates。
// 空串或 "null" 返回零值结构体。
func parseMessageTemplates(raw string) (MessageTemplates, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return MessageTemplates{}, nil
	}
	var tpl MessageTemplates
	if err := json.Unmarshal([]byte(raw), &tpl); err != nil {
		return MessageTemplates{}, fmt.Errorf("message_config 非法 JSON: %w", err)
	}
	return tpl, nil
}

// resolveMenuPath 按 path 在嵌套 MenuRows 中定位按钮。
//
// path 格式约定（任务 8、任务 11）：
//
//	"row{i}.btn{j}"                              // 根层按钮
//	"row{i}.btn{j}.row{k}.btn{l}"                // 二级（submenu 内）
//	"row{i}.btn{j}.row{k}.btn{l}.row{m}.btn{n}"  // 三级（MaxMenuDepth=3 封顶）
//
// 返回定位到的按钮和 ok=true；任何格式/越界/字段异常都返回零值 + false，不 panic。
//
// 纯函数，无副作用，可在单测中独立验证。
func resolveMenuPath(rows []DesignerMenuRow, path string) (DesignerMenuButton, bool) {
	path = strings.TrimSpace(path)
	if path == "" {
		return DesignerMenuButton{}, false
	}
	segments := strings.Split(path, ".")
	// 段数必须是偶数（row / btn 成对）。
	if len(segments) == 0 || len(segments)%2 != 0 {
		return DesignerMenuButton{}, false
	}
	currentRows := rows
	var current DesignerMenuButton
	for i := 0; i < len(segments); i += 2 {
		rowSeg := segments[i]
		btnSeg := segments[i+1]
		if !strings.HasPrefix(rowSeg, "row") || !strings.HasPrefix(btnSeg, "btn") {
			return DesignerMenuButton{}, false
		}
		rowIdx, err := strconv.Atoi(strings.TrimPrefix(rowSeg, "row"))
		if err != nil || rowIdx < 0 || rowIdx >= len(currentRows) {
			return DesignerMenuButton{}, false
		}
		btnIdx, err := strconv.Atoi(strings.TrimPrefix(btnSeg, "btn"))
		if err != nil || btnIdx < 0 || btnIdx >= len(currentRows[rowIdx].Buttons) {
			return DesignerMenuButton{}, false
		}
		current = currentRows[rowIdx].Buttons[btnIdx]
		currentRows = current.Submenu
	}
	return current, true
}
