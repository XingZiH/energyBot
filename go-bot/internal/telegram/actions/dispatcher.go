package actions

import (
	"context"
	"fmt"
	"strings"
)

// BotAPI 是 actions 子包需要的 bot 能力抽象。
//
// 保持尽可能窄：只列出骨架实现用到的方法。任务 8/9/10 接入真实业务时按需扩展：
//   - 任务 8（submenu）：SendMessageWithInline(chatID, text, rows) ✓
//   - 任务 9（energy_package_group）：LoadPackagesByIDs(ctx, ids) ✓
//   - 任务 10B（command/start/address/wallet/orders）：新增下列 5 个业务入口 ✓
//
// 单测通过 mockBot 提供实现；生产由 telegram.Bot 适配。
type BotAPI interface {
	SendMessage(ctx context.Context, chatID int64, text string, markup any) error
	// SendMessageWithInline 发送带 Inline Keyboard 的消息。
	// rows 的每一行是一排按钮，最终由适配层转换为 Telegram 的 inline_keyboard 结构。
	SendMessageWithInline(ctx context.Context, chatID int64, text string, rows [][]InlineButton) error
	// LoadPackagesByIDs 按 ID 批量加载套餐信息用于套餐组展开。
	//
	// 实现方（bot.go）负责：
	//   - 从数据库加载 telegram.EnergyPackage 并映射为 PackageInfo
	//   - 把 PriceSun（Sun 单位字符串）换算为 Price（TRX 单位 float64），1 TRX = 1e6 Sun
	//   - 部分 ID 不存在时返回能加载到的子集（不报错），由本包 handler 决定展示策略
	//   - 返回的顺序不约定，handler 内部自行排序
	LoadPackagesByIDs(ctx context.Context, ids []int) ([]PackageInfo, error)

	// 以下 5 个业务入口由任务 10B 加入，用于把 5 个 action handler 从占位文本
	// 切换到真实业务调用。
	//
	// 命名约定：Show* 是交互式展示（发送菜单/消息），RunCommand 是命令分发。
	// 实现方（bot.go）只做转发到已有业务方法，不在此包实现业务逻辑。

	// ShowStart 展示欢迎界面与主菜单（语义对齐 /start 命令）。
	ShowStart(ctx context.Context, chatID int64) error
	// ShowAddressManagement 展示地址管理面板。
	ShowAddressManagement(ctx context.Context, chatID int64) error
	// ShowWalletQuery 展示钱包查询入口。
	ShowWalletQuery(ctx context.Context, chatID int64) error
	// ShowOrders 展示订单列表。任务 10B 先占位；任务 12 接入 MessageConfig 模板渲染。
	ShowOrders(ctx context.Context, chatID int64) error
	// RunCommand 分发命令字符串（如 "/start" "/menu"）。
	// 已知命令由实现方路由到具体业务；未知命令由实现方决定友好提示策略。
	// 调用方传入前应保证 cmd 非空且已 trim（Dispatcher.handleCommand 已负责此契约）。
	RunCommand(ctx context.Context, chatID int64, cmd string) error
}

// PackageInfo 是 actions 包内部使用的套餐信息结构，专供套餐组展开消费。
//
// 独立于 telegram.EnergyPackage 定义，避免 actions → telegram 的循环 import。
// 字段集合刻意最小化，只包含模板渲染（{name}/{price}/{energy}）和排序所需的字段；
// 新增字段前先核对是否在套餐组局部模板白名单内，避免超前设计。
//
// 注意单位约定：Price 是 TRX 单位的 float64（已从 PriceSun 换算），
// 展示时用 %.2f 格式化；单位换算由 bot.go 的 LoadPackagesByIDs 实现负责。
type PackageInfo struct {
	ID     int     // 套餐 ID，用于 callback_data 拼接（pkg:{id}）
	Name   string  // 套餐名称，对应模板变量 {name}
	Price  float64 // 单价（TRX），对应模板变量 {price}，同时用于 price_asc/price_desc 排序
	Energy int     // 能量数，对应模板变量 {energy}
}

// InlineButton 是 actions 包内部使用的 inline keyboard 按钮结构。
//
// 独立于 telegram.inlineKeyboardButton 定义，避免 actions → telegram 的 import 依赖
// （bot.go 适配层在调用 SendMessageWithInline 的实现时把本结构映射为 telegram 包内的 struct）。
type InlineButton struct {
	Text         string
	CallbackData string
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

	// Path 是按钮在菜单树中的坐标，用于 submenu 子按钮拼接 callback_data。
	// 格式：row{i}.btn{j}[.row{i}.btn{j}]*
	//   - 根层 row0 的第 1 个按钮：Path = "row0.btn1"
	//   - 上述按钮的 submenu 里 row0 第 2 个按钮：Path = "row0.btn1.row0.btn2"
	// 由调用方（bot.go）在分发前按按钮遍历位置赋值；其它 action 可以不设。
	Path string
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
