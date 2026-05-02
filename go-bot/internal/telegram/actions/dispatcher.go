package actions

import (
	"context"
	"fmt"
	"strings"
)

// BotAPI 是 actions 子包需要的 bot 能力抽象。
//
// 保持尽可能窄：只列出骨架实现用到的方法。任务 8/9/10 接入真实业务时可按需扩展：
//   - 任务 8（submenu）：SendMessageWithInline(chatID, text, markup)
//   - 任务 9（energy_package_group）：LoadPackagesByIDs(ctx, ids)
//   - 任务 10（command/start/address/wallet/orders）：可能追加若干
//     SendAddressManagement / SendWalletQueryMenu / SendPackageMenu 等
//
// 单测通过 mockBot 提供实现；生产由 telegram.Bot 适配。
type BotAPI interface {
	SendMessage(ctx context.Context, chatID int64, text string, markup any) error
}

// ButtonSpec 是 Dispatch 方法需要的按钮参数。
//
// 字段集合对应 telegram.DesignerMenuButton 的子集。独立声明避免循环 import。
// 调用方（bot.go）负责把 DesignerMenuButton 的字段逐一映射到本结构体。
type ButtonSpec struct {
	Action       string
	Text         string
	URL          string
	Message      string
	Command      string
	PackageID    int // v1 遗留字段；v2 骨架不使用，保留以支持后续 v1→v2 迁移路径。
	Submenu      []RowSpec
	PackageGroup *PackageGroupSpec
}

// RowSpec 是 Submenu 中的一行按钮。
type RowSpec struct {
	Buttons []ButtonSpec
}

// PackageGroupSpec 描述套餐组按钮的展开规则。
// 与 telegram.PackageGroupConfig 字段对齐。
type PackageGroupSpec struct {
	PackageIDs   []int
	SortBy       string
	TextTemplate string
}

// Dispatcher 把 ButtonSpec 按 Action 字段分派到对应的 handleXxx 方法。
type Dispatcher struct {
	bot BotAPI
}

// NewDispatcher 构造 Dispatcher。bot 参数不应为 nil。
func NewDispatcher(bot BotAPI) *Dispatcher {
	return &Dispatcher{bot: bot}
}

// Dispatch 根据 spec.Action 调用对应的 handler。
//
// 未知 action 返回 ErrUnknownAction（不 panic）；参数校验失败返回对应 sentinel error。
// 业务错误（例如 BotAPI.SendMessage 报错）原样冒泡。
func (d *Dispatcher) Dispatch(ctx context.Context, chatID int64, spec ButtonSpec) error {
	action := strings.TrimSpace(spec.Action)
	if action == "" {
		return ErrEmptyAction
	}
	switch action {
	case ActionURL:
		return d.handleURL(ctx, chatID, spec)
	case ActionText:
		return d.handleText(ctx, chatID, spec)
	case ActionCommand:
		return d.handleCommand(ctx, chatID, spec)
	case ActionStart:
		return d.handleStart(ctx, chatID, spec)
	case ActionSubmenu:
		return d.handleSubmenu(ctx, chatID, spec)
	case ActionEnergyPackageGroup:
		return d.handleEnergyPackageGroup(ctx, chatID, spec)
	case ActionAddressManage:
		return d.handleAddressManage(ctx, chatID, spec)
	case ActionWalletQuery:
		return d.handleWalletQuery(ctx, chatID, spec)
	case ActionOrders:
		return d.handleOrders(ctx, chatID, spec)
	default:
		return fmt.Errorf("%w: %s", ErrUnknownAction, action)
	}
}
