// Package actions 提供设计器 v2 按钮点击事件的分发逻辑。
//
// 本包独立于 telegram 包：通过 BotAPI 接口抽象所需 bot 能力，
// 通过 ButtonSpec 独立结构体接收按钮参数，避免与 telegram 包循环 import。
// bot.go 在调用 Dispatcher.Dispatch 前负责把 telegram.DesignerMenuButton
// 映射为 actions.ButtonSpec。
//
// 9 种 ButtonAction 的字符串常量必须与 telegram/designer.go 的 ButtonAction
// 枚举保持严格一致。修改常量字面值时两处必须同步更新。
package actions

import "errors"

// 与 telegram/designer.go 保持同步的 action 字符串常量。
//
// 为避免 actions → telegram 的导入依赖（telegram 后续还要反向引用 actions），
// 这里用本包内的独立 const 声明。任何一侧变更都必须同步另一侧，
// 否则 bot.go 的字段映射会把 designer 解析出的 ButtonAction 传给本包后走到
// unknown 分支，返回 ErrUnknownAction。
const (
	ActionURL                = "url"
	ActionText               = "text"
	ActionCommand            = "command"
	ActionStart              = "start"
	ActionSubmenu            = "submenu"
	ActionEnergyPackageGroup = "energy_package_group"
	ActionAddressManage      = "address_manage"
	ActionWalletQuery        = "wallet_query"
	ActionOrders             = "orders"
)

// 分发错误。调用方可通过 errors.Is 进行判定。
var (
	// ErrEmptyAction 表示 ButtonSpec.Action 为空字符串。
	ErrEmptyAction = errors.New("action 为空")

	// ErrUnknownAction 表示 ButtonSpec.Action 不在 9 种已知枚举内。
	// 最终错误信息会用 fmt.Errorf("%w: %s", ErrUnknownAction, action) 附加具体 action 字符串。
	ErrUnknownAction = errors.New("未知 action")

	// ErrEmptySubmenu 表示 submenu action 的 Submenu 切片为空。
	ErrEmptySubmenu = errors.New("submenu 为空")

	// ErrInvalidPackageGroup 表示 energy_package_group action 的 PackageGroup
	// 为 nil 或 PackageIDs 为空。
	ErrInvalidPackageGroup = errors.New("package_group 配置无效")

	// ErrMissingPath 表示 submenu action 缺失 ButtonSpec.Path 字段。
	// Path 是拼接子按钮 callback_data 的基底，由 bot.go 在分发前按按钮坐标赋值。
	ErrMissingPath = errors.New("submenu 缺失 ButtonSpec.Path")

	// ErrCallbackTooLong 表示拼接出的 callback_data 超过 Telegram Bot API
	// 协议上限（64 字节）。通常意味着 submenu 嵌套过深或下标过大，需调整菜单设计。
	ErrCallbackTooLong = errors.New("callback_data 超过 Telegram 64 字节上限")
)
