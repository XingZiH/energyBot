package telegram_test

import (
	"testing"

	"ng-antd-admin/go-bot/internal/telegram"
	"ng-antd-admin/go-bot/internal/telegram/actions"
)

// TestActionConstantsSynced 验证 telegram 与 actions 两个包的 9 个 action 常量字面值严格一致。
//
// 三端契约（go-bot / 前端 types.ts / NestJS DTO）以 telegram/designer.go 为权威源，
// actions 包出于循环 import 防御独立定义了一份副本。两处任何漂移都会破坏分发路径，
// 该表驱动测试会在漂移发生的第一时间失败，提示同步维护。
//
// 使用 external test package (package telegram_test) 以避免 telegram 包内部测试
// 反向 import telegram/actions 时潜在的包组织歧义。
func TestActionConstantsSynced(t *testing.T) {
	cases := []struct {
		name     string
		telegram telegram.ButtonAction
		actions  string
	}{
		{"url", telegram.ActionURL, actions.ActionURL},
		{"text", telegram.ActionText, actions.ActionText},
		{"command", telegram.ActionCommand, actions.ActionCommand},
		{"start", telegram.ActionStart, actions.ActionStart},
		{"submenu", telegram.ActionSubmenu, actions.ActionSubmenu},
		{"energy_package_group", telegram.ActionEnergyPackageGroup, actions.ActionEnergyPackageGroup},
		{"address_manage", telegram.ActionAddressManage, actions.ActionAddressManage},
		{"wallet_query", telegram.ActionWalletQuery, actions.ActionWalletQuery},
		{"orders", telegram.ActionOrders, actions.ActionOrders},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if string(tc.telegram) != tc.actions {
				t.Errorf("action %q 漂移: telegram=%q actions=%q", tc.name, tc.telegram, tc.actions)
			}
		})
	}
}
