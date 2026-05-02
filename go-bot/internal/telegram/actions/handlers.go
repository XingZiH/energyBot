package actions

import (
	"context"
	"fmt"
	"strings"
)

// 下列 handler 为骨架。已接入的：
//   - url / text：v1 语义 SendMessage
//   - submenu（任务 8）：渲染 Inline Keyboard
//
// 其余 6 个返回统一前缀 "[action 待接入" 的占位消息，便于后续任务接入时搜索。
//
// 接入计划：
//   - 任务 9：handleEnergyPackageGroup 改为展开套餐列表
//   - 任务 10：handleCommand / handleStart / handleAddressManage /
//     handleWalletQuery / handleOrders 接入对应业务

// Submenu 渲染相关常量。
const (
	// callbackPrefix 是所有 v2 菜单按钮 callback_data 的统一前缀。
	// 任务 11 的 callback_query 处理器通过此前缀识别 v2 菜单点击事件。
	callbackPrefix = "menu:"

	// callbackBack 是"返回上一级"按钮的 callback_data。
	// 任务 11 接入时通过此常量识别返回意图（无需携带父 path，由会话状态回退）。
	callbackBack = "menu:back"

	// callbackMaxBytes 是 Telegram Bot API 对 callback_data 的协议硬限：1-64 字节。
	// 参见 https://core.telegram.org/bots/api#inlinekeyboardbutton
	callbackMaxBytes = 64

	// submenuBackText 是"返回上一级"按钮的文案（含 🔙 emoji，UTF-8 编码）。
	submenuBackText = "🔙 返回"

	// submenuDefaultPrompt 是 submenu 未配置 Text 时的兜底提示语。
	submenuDefaultPrompt = "请选择："

	// submenuEmptyButtonText 是子按钮 Text 空白时的兜底文案。
	submenuEmptyButtonText = "(未命名)"
)

// buildCallbackData 拼接 submenu 子按钮的 callback_data。
//
// parentPath 是当前 submenu 触发按钮自身的 Path（例如 "row0.btn1"）。
// childRow/childBtn 是子菜单内的行列下标。
//
// 返回的字符串形如 "menu:row0.btn1.row{childRow}.btn{childBtn}"。
// 若最终字节数超过 callbackMaxBytes 则返回 ErrCallbackTooLong（包装了具体字节数和完整字符串）。
func buildCallbackData(parentPath string, childRow, childBtn int) (string, error) {
	s := fmt.Sprintf("%s%s.row%d.btn%d", callbackPrefix, parentPath, childRow, childBtn)
	if len(s) > callbackMaxBytes {
		return "", fmt.Errorf("%w: %d 字节（上限 %d）: %s", ErrCallbackTooLong, len(s), callbackMaxBytes, s)
	}
	return s, nil
}

// handleURL 发送一条包含 URL 文本的消息。空 URL 时发送兜底文案。
func (d *Dispatcher) handleURL(ctx context.Context, chatID int64, spec ButtonSpec) error {
	url := strings.TrimSpace(spec.URL)
	if url == "" {
		url = "链接暂未配置。"
	}
	return d.bot.SendMessage(ctx, chatID, url, nil)
}

// handleText 发送一条纯文本消息。空 Message 时发送"已收到。"（对齐 v1 行为）。
func (d *Dispatcher) handleText(ctx context.Context, chatID int64, spec ButtonSpec) error {
	msg := strings.TrimSpace(spec.Message)
	if msg == "" {
		msg = "已收到。"
	}
	return d.bot.SendMessage(ctx, chatID, msg, nil)
}

// handleCommand 触发内部命令（/start 等）。任务 10 接入真实命令分发。
func (d *Dispatcher) handleCommand(ctx context.Context, chatID int64, spec ButtonSpec) error {
	cmd := strings.TrimSpace(spec.Command)
	return d.bot.SendMessage(ctx, chatID,
		fmt.Sprintf("[command 待接入: %s]", cmd), nil)
}

// handleStart 显示欢迎界面 + 主菜单。任务 10 接入。
func (d *Dispatcher) handleStart(ctx context.Context, chatID int64, _ ButtonSpec) error {
	return d.bot.SendMessage(ctx, chatID, "[start 待接入]", nil)
}

// handleSubmenu 把 spec.Submenu 渲染成 Inline Keyboard 发出。
//
// 行为：
//   - 遍历 spec.Submenu 每行每按钮，生成 InlineButton{Text, CallbackData}
//   - CallbackData = "menu:<spec.Path>.row{i}.btn{j}"，超过 64 字节返回 ErrCallbackTooLong
//   - 按钮 Text 为空/全空白时回落为 "(未命名)"
//   - 末尾自动追加一行 "🔙 返回"（callback_data = "menu:back"）
//   - 消息文本用 spec.Text；为空时回落为 "请选择："
//
// 严格无状态：callback_data 完整自包含 path 信息，任务 11 解析后重新加载 menu_config 查按钮。
func (d *Dispatcher) handleSubmenu(ctx context.Context, chatID int64, spec ButtonSpec) error {
	if len(spec.Submenu) == 0 {
		return ErrEmptySubmenu
	}
	if strings.TrimSpace(spec.Path) == "" {
		return ErrMissingPath
	}

	rows := make([][]InlineButton, 0, len(spec.Submenu)+1)
	for i, row := range spec.Submenu {
		line := make([]InlineButton, 0, len(row.Buttons))
		for j, btn := range row.Buttons {
			cbData, err := buildCallbackData(spec.Path, i, j)
			if err != nil {
				return err
			}
			text := strings.TrimSpace(btn.Text)
			if text == "" {
				text = submenuEmptyButtonText
			}
			line = append(line, InlineButton{Text: text, CallbackData: cbData})
		}
		rows = append(rows, line)
	}

	// 追加返回按钮：单独一行。
	rows = append(rows, []InlineButton{{Text: submenuBackText, CallbackData: callbackBack}})

	prompt := strings.TrimSpace(spec.Text)
	if prompt == "" {
		prompt = submenuDefaultPrompt
	}

	return d.bot.SendMessageWithInline(ctx, chatID, prompt, rows)
}

// handleEnergyPackageGroup 展开套餐组 Inline Keyboard。任务 9 实现。
func (d *Dispatcher) handleEnergyPackageGroup(ctx context.Context, chatID int64, spec ButtonSpec) error {
	if spec.PackageGroup == nil || len(spec.PackageGroup.PackageIDs) == 0 {
		return ErrInvalidPackageGroup
	}
	return d.bot.SendMessage(ctx, chatID,
		fmt.Sprintf("[package_group 待接入，%d 个套餐]", len(spec.PackageGroup.PackageIDs)), nil)
}

// handleAddressManage 进入地址管理。任务 10 接入。
func (d *Dispatcher) handleAddressManage(ctx context.Context, chatID int64, _ ButtonSpec) error {
	return d.bot.SendMessage(ctx, chatID, "[address_manage 待接入]", nil)
}

// handleWalletQuery 进入钱包查询。任务 10 接入。
func (d *Dispatcher) handleWalletQuery(ctx context.Context, chatID int64, _ ButtonSpec) error {
	return d.bot.SendMessage(ctx, chatID, "[wallet_query 待接入]", nil)
}

// handleOrders 进入订单查询。任务 10 接入。
func (d *Dispatcher) handleOrders(ctx context.Context, chatID int64, _ ButtonSpec) error {
	return d.bot.SendMessage(ctx, chatID, "[orders 待接入]", nil)
}
