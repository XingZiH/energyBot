package telegram

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"ng-antd-admin/go-bot/internal/telegram/actions"
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
