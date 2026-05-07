package telegram

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/anomalyco/energybot-bot/internal/telegram/actions"
	"github.com/anomalyco/energybot-bot/internal/telegram/template"
)

// 编译期断言：Bot 必须实现 actions.BotAPI。
// 接口一旦扩展、Bot 未同步实现，此处直接编译失败。
var _ actions.BotAPI = (*Bot)(nil)

// SendMessage 实现 actions.BotAPI。
//
// 包内部调用路径继续使用 lowercase 的 sendMessage；本导出方法仅为接口契约，
// 供 actions 子包通过 BotAPI 回调 Bot。
func (b *Bot) SendMessage(ctx context.Context, chatID int64, text string, markup any) error {
	return b.sendMessage(ctx, chatID, text, markup)
}

// SendMessageWithInline 实现 actions.BotAPI。
//
// 把 actions.InlineButton 的二维切片转换为 Telegram 包内的 inlineKeyboardButton 结构
// 并调用 sendMessage 发送。rows 为空时降级为无键盘的纯文本发送。
func (b *Bot) SendMessageWithInline(ctx context.Context, chatID int64, text string, rows [][]actions.InlineButton) error {
	keyboard := convertInlineRows(rows)
	if keyboard == nil {
		return b.sendMessage(ctx, chatID, text, nil)
	}
	return b.sendMessage(ctx, chatID, text, &inlineKeyboardMarkup{InlineKeyboard: keyboard})
}

// LoadPackagesByIDs 实现 actions.BotAPI。
//
// 按 ID 加载 EnergyPackage 并映射为 actions.PackageInfo。采用「一次 listPackages
// 之后 in-memory 过滤」策略（对齐 v1 的读取方式、避免 N 次数据库查询）。
// 单位换算：PriceSun（字符串，Sun 单位） → Price（float64，TRX 单位），1 TRX = 1e6 Sun。
//
// 语义：
//   - 空 ids 返回 nil（不查 DB）
//   - DB 错误冒泡
//   - 不存在或 PriceSun 解析失败的 id 跳过（对齐任务 9 "部分加载失败" 语义，
//     由 handler 决定如何展示剩余集合）
//   - 返回顺序遵循入参 ids 顺序
func (b *Bot) LoadPackagesByIDs(ctx context.Context, ids []int) ([]actions.PackageInfo, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	all, err := b.listPackages(ctx)
	if err != nil {
		return nil, err
	}
	byID := make(map[int]EnergyPackage, len(all))
	for _, p := range all {
		byID[p.ID] = p
	}
	out := make([]actions.PackageInfo, 0, len(ids))
	for _, id := range ids {
		pkg, ok := byID[id]
		if !ok {
			continue
		}
		priceTRX, err := parsePriceSunToTRX(pkg.PriceSun)
		if err != nil {
			continue
		}
		out = append(out, actions.PackageInfo{
			ID:     pkg.ID,
			Name:   pkg.PackageName,
			Price:  priceTRX,
			Energy: pkg.EnergyAmount,
		})
	}
	return out, nil
}

// convertInlineRows 把 actions.InlineButton 的二维切片转换为 Telegram 包内的
// inlineKeyboardButton 二维切片。
//
// 空输入（nil 或 len==0）返回 nil，便于调用方据此降级为无键盘发送。
// 内层空行保留（不裁剪），由调用方和 Telegram 服务端决定处理方式。
func convertInlineRows(rows [][]actions.InlineButton) [][]inlineKeyboardButton {
	if len(rows) == 0 {
		return nil
	}
	keyboard := make([][]inlineKeyboardButton, 0, len(rows))
	for _, row := range rows {
		line := make([]inlineKeyboardButton, 0, len(row))
		for _, btn := range row {
			line = append(line, inlineKeyboardButton{
				Text:         btn.Text,
				CallbackData: btn.CallbackData,
			})
		}
		keyboard = append(keyboard, line)
	}
	return keyboard
}

// parsePriceSunToTRX 把 Sun 单位的价格字符串换算为 TRX 单位的 float64。
// 1 TRX = 1e6 Sun。
//
// 接受前后空白；拒绝空字符串、非数字、负数。
func parsePriceSunToTRX(priceSun string) (float64, error) {
	trimmed := strings.TrimSpace(priceSun)
	if trimmed == "" {
		return 0, fmt.Errorf("empty PriceSun")
	}
	sun, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid PriceSun %q: %w", priceSun, err)
	}
	if sun < 0 {
		return 0, fmt.Errorf("negative PriceSun %d", sun)
	}
	return float64(sun) / 1e6, nil
}

// ShowStart 实现 actions.BotAPI。
//
// 语义等价于用户发送 /start：渲染并推送主菜单（套餐卡片 + 底部 Reply Keyboard）。
// sendPackageMenu 已使用 BotDesignerConfig.WelcomeText 兜底；
// MessageTemplates.Welcome 作为独立的欢迎词场景，属 Level 2，待后续任务接入。
func (b *Bot) ShowStart(ctx context.Context, chatID int64) error {
	return b.sendPackageMenu(ctx, chatID)
}

// ShowAddressManagement 实现 actions.BotAPI。
// 展示地址管理面板（转发到 v1 的 sendAddressManagement）。
func (b *Bot) ShowAddressManagement(ctx context.Context, chatID int64) error {
	return b.sendAddressManagement(ctx, chatID)
}

// ShowWalletQuery 实现 actions.BotAPI。
// 展示钱包查询入口（转发到 v1 的 sendWalletQueryMenu）。
func (b *Bot) ShowWalletQuery(ctx context.Context, chatID int64) error {
	return b.sendWalletQueryMenu(ctx, chatID)
}

// ShowOrders 实现 actions.BotAPI。
//
// 当前仅发送固定占位消息。订单列表的真实渲染（DB 查询 + 分页 + 状态文案）
// 不在任务 12（9 场景模板）范围内，待独立任务补齐。
func (b *Bot) ShowOrders(ctx context.Context, chatID int64) error {
	return b.sendMessage(ctx, chatID, "订单查询功能即将上线。", nil)
}

// buildButtonSpec 把 telegram.DesignerMenuButton 映射为 actions.ButtonSpec。
//
// path 是按钮在菜单树中的坐标（如 "row0.btn1"），用于 Dispatcher 的 submenu
// 分支在下钻时拼接 callback_data。其它 action 可以不设。
//
// 映射规则：
//   - 基本字段（Action/Text/URL/Message/Command）透传，ButtonAction 枚举值
//     通过 string 强转——actions 包的常量与 telegram.ButtonAction 的字符串值
//     逐一对齐（由 designer_sync_test.go 守护）。
//   - Submenu 递归映射；子按钮的 Path 字段留空：callback_data 由
//     actions.handleSubmenu 基于父 Path + 遍历坐标动态生成，子 ButtonSpec
//     的 Path 只在任务 11 解析 callback_query 时才会被回填。
//   - PackageGroup 逐字段拷贝；nil 透传。
func buildButtonSpec(btn DesignerMenuButton, path string) actions.ButtonSpec {
	spec := actions.ButtonSpec{
		Action:           string(btn.Action),
		Text:             btn.Text,
		URL:              btn.URL,
		Message:          btn.Message,
		Command:          btn.Command,
		SubmenuText:      btn.SubmenuText,
		PackageGroupText: btn.PackageGroupText,
		Path:             path,
	}
	if len(btn.Submenu) > 0 {
		spec.Submenu = make([]actions.RowSpec, 0, len(btn.Submenu))
		for _, row := range btn.Submenu {
			line := actions.RowSpec{Buttons: make([]actions.ButtonSpec, 0, len(row.Buttons))}
			for _, child := range row.Buttons {
				line.Buttons = append(line.Buttons, buildButtonSpec(child, ""))
			}
			spec.Submenu = append(spec.Submenu, line)
		}
	}
	if btn.PackageGroup != nil {
		spec.PackageGroup = &actions.PackageGroupSpec{
			PackageIDs:   btn.PackageGroup.PackageIDs,
			TextTemplate: btn.PackageGroup.TextTemplate,
			SortBy:       btn.PackageGroup.SortBy,
		}
	}
	return spec
}

// RunCommand 实现 actions.BotAPI。
//
// 把按钮配置中的命令字符串分发到对应业务入口。当前支持：
//   - "/start"、"/menu"：对齐 v1 isMenuCommand 的同义集合，走 sendPackageMenu
//
// 未识别的命令不报错，给用户一条友好提示（避免菜单编辑错误导致用户侧静默）。
// 调用方（Dispatcher.handleCommand）已负责：去空白、拒绝空字符串。
func (b *Bot) RunCommand(ctx context.Context, chatID int64, cmd string) error {
	cmd = strings.TrimSpace(cmd)
	switch cmd {
	case "/start", "/menu":
		return b.sendPackageMenu(ctx, chatID)
	default:
		cfg, _ := b.loadDesignerConfig(ctx)
		text := b.renderMessage(
			cfg.MessageConfig.UnknownCommand,
			map[string]string{"command": cmd},
			fmt.Sprintf("命令 %s 暂未支持。", cmd),
		)
		return b.sendMessage(ctx, chatID, text, nil)
	}
}

// renderMessage 用设计器 v2 的消息模板字段渲染用户面消息（任务 12）。
//
// 行为：
//   - tpl 去空白后为空串，返回 fallback（兜底文案）
//   - tpl 非空则交给 template.Render：{name} 占位符按 vars 替换，未知变量保留原样
//
// vars 为 nil 时等价于空 map，允许调用方省略。
//
// 典型用法：
//
//	text := b.renderMessage(cfg.MessageConfig.PackageUnavailable, nil,
//	    "当前没有启用的能量套餐，请联系管理员。")
//	b.sendMessage(ctx, chatID, text, markup)
//
// 设计要点：
//   - 纯函数（不依赖 Bot 状态），方法形式只是让调用方少拼一层包路径
//   - 不返回 error：template.Render 本身容错，空模板走 fallback 即可
func (b *Bot) renderMessage(tpl string, vars map[string]string, fallback string) string {
	if strings.TrimSpace(tpl) == "" {
		return fallback
	}
	return template.Render(tpl, vars)
}

// TODO(任务 12 Level 3): 以下 4 个消息模板场景待接入，建议在 PR3 UI 阶段或独立任务补齐：
//   - PayPending        → 支付等待中（需要支付状态查询入口，相关代码在 bot.go 的支付轮询/回调链路）
//   - PaySuccess        → 支付成功（订单状态变更为 paid 时的用户通知）
//   - PayFailed         → 支付失败/超时（订单过期或链上回执失败）
//   - WalletQueryResult → 钱包查询结果（sendWalletSnapshot，当前链上数据由 walletSnapshotText 硬编码）
//
// 已完成（Level 1）：
//   - PackageUnavailable → sendPackageMenu 空套餐分支
//   - UnknownCommand     → RunCommand 未知命令兜底，支持 {command} 变量
//   - AddressInvalid     → handleMessage 收到非法 TRON 地址时
