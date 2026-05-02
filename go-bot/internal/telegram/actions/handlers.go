package actions

import (
	"context"
	"fmt"
	"strings"
)

// 下列 handler 为骨架。已接入 bot.SendMessage 的仅 url / text 两个（与 v1 语义一致）；
// 其余 7 个返回统一前缀 "[action 待接入" 的占位消息，便于后续任务接入时搜索。
//
// 接入计划：
//   - 任务 8：handleSubmenu 改为发送 Inline Keyboard
//   - 任务 9：handleEnergyPackageGroup 改为展开套餐列表
//   - 任务 10：handleCommand / handleStart / handleAddressManage /
//     handleWalletQuery / handleOrders 接入对应业务

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

// handleSubmenu 进入子菜单（Inline Keyboard）。任务 8 实现。
func (d *Dispatcher) handleSubmenu(ctx context.Context, chatID int64, spec ButtonSpec) error {
	if len(spec.Submenu) == 0 {
		return ErrEmptySubmenu
	}
	return d.bot.SendMessage(ctx, chatID,
		fmt.Sprintf("[submenu 待接入，%d 个子项]", len(spec.Submenu)), nil)
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
