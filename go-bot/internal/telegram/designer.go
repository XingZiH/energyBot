package telegram

import (
	"encoding/json"
	"fmt"
	"strings"
)

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
	if err := validateMenuRows(rows, 1, 3); err != nil {
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
