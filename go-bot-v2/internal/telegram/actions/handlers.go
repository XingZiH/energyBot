package actions

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/anomalyco/energybot-bot/internal/telegram/template"
)

// 下列 handler 为骨架。已接入的：
//   - url / text：v1 语义 SendMessage
//   - submenu（任务 8）：渲染 Inline Keyboard
//   - energy_package_group（任务 9）：加载→排序→模板渲染→Inline Keyboard
//   - command / start / address_manage / wallet_query / orders（任务 10B）：
//     通过 BotAPI 新增的 ShowStart / ShowAddressManagement / ShowWalletQuery /
//     ShowOrders / RunCommand 转发到 Bot 的真实业务方法

// Submenu 渲染相关常量。
const (
	// callbackPrefix 是所有 v2 菜单按钮 callback_data 的统一前缀。
	// 任务 11 的 callback_query 处理器通过此前缀识别 v2 菜单点击事件。
	callbackPrefix = "menu:"

	// callbackBackPrefix 是"返回上一级"按钮 callback_data 的前缀。
	//
	// 完整格式：menu:back:<parentPath>
	//   - parentPath 为父 submenu 触发按钮自身 Path 的父路径（见 parentOfPath）。
	//   - 特例：根菜单下的 submenu 按钮触发，parentPath 为空字符串 →
	//     callback_data = "menu:back:"（解析时空父路径视为"返回根菜单"，
	//     由 bot.go:navigateToMenuPath 调用 sendPackageMenu）。
	//
	// 设计动机：v2 菜单是无状态分发，返回按钮必须自带目标路径，才能在 callback_query
	// 中重新定位按钮并重新展开；不依赖任何会话存储。
	callbackBackPrefix = "menu:back:"

	// callbackMaxBytes 是 Telegram Bot API 对 callback_data 的协议硬限：1-64 字节。
	// 参见 https://core.telegram.org/bots/api#inlinekeyboardbutton
	callbackMaxBytes = 64

	// submenuBackText 是"返回上一级"按钮的文案（含 🔙 emoji，UTF-8 编码）。
	submenuBackText = "🔙 返回"

	// submenuDefaultPrompt 是 submenu 未配置 Text 时的兜底提示语。
	submenuDefaultPrompt = "请选择："

	// submenuEmptyButtonText 是子按钮 Text 空白时的兜底文案。
	submenuEmptyButtonText = "(未命名)"

	// callbackPackagePrefix 是套餐组按钮 callback_data 的前缀。
	// 格式：pkg:<packageId>，任务 11 的 callback_query 处理器通过此前缀识别套餐选择事件。
	// 典型长度：4（前缀）+ 最多 11（int32）= 15 字节，远小于 64 字节上限，因此不做长度校验。
	callbackPackagePrefix = "pkg:"

	// packageGroupPrompt 是套餐组展开时的消息提示语。
	// 统一文案不拼接 spec.Text（按钮名已在父菜单体现，避免冗余）。
	packageGroupPrompt = "请选择套餐："

	// packageGroupUnavailableText 是所有套餐都加载失败时发送的纯文本兜底文案。
	packageGroupUnavailableText = "套餐暂时不可用"

	// packageGroupDefaultTemplate 是 PackageGroupSpec.TextTemplate 为空时的默认按钮文案模板。
	// 用套餐组局部变量（name/price），不是全局白名单的 packageName。
	packageGroupDefaultTemplate = "{name} - {price} TRX"
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

// parentOfPath 返回一个 menu path 的父路径。
//
// 约定（任务 8）：path 由 ".row{i}.btn{j}" 段拼接而成，例如：
//   - "row0.btn1" → ""（父为根，空串）
//   - "row0.btn1.row0.btn2" → "row0.btn1"
//   - "" → ""（已经在根，父仍为根）
//
// 实现：剥离最后一个 ".row" 之后的内容即可得到父路径。
// 找不到 ".row" 说明是顶层单段（如 "row0.btn1"），父为根，返回空串。
func parentOfPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	idx := strings.LastIndex(path, ".row")
	if idx < 0 {
		// 顶层单段（"rowI.btnJ"），父是根。
		return ""
	}
	return path[:idx]
}

// buildBackCallbackData 构造返回按钮的 callback_data。
//
// parentPath 为空时返回 "menu:back:"（代表返回根菜单）。
// 长度超过 64 字节返回 ErrCallbackTooLong；实际上 parentPath 总是子 path 的前缀，
// 而子 path 已经通过 buildCallbackData 的长度校验，因此这里几乎不会触发。
func buildBackCallbackData(parentPath string) (string, error) {
	s := callbackBackPrefix + parentPath
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

// handleCommand 把按钮配置的命令字符串（spec.Command）转发给 BotAPI.RunCommand。
//
// 契约：Command 空字符串（或全空白）被视为配置错误，直接返回 ErrEmptyCommand，
// 不发任何消息。调用方应在菜单配置环节校验，避免运行时到达此分支。
func (d *Dispatcher) handleCommand(ctx context.Context, chatID int64, spec ButtonSpec) error {
	cmd := strings.TrimSpace(spec.Command)
	if cmd == "" {
		return ErrEmptyCommand
	}
	return d.bot.RunCommand(ctx, chatID, cmd)
}

// handleStart 展示欢迎界面与主菜单，等同于用户发送 /start。
func (d *Dispatcher) handleStart(ctx context.Context, chatID int64, _ ButtonSpec) error {
	return d.bot.ShowStart(ctx, chatID)
}

// handleSubmenu 把 spec.Submenu 渲染成 Inline Keyboard 发出。
//
// 行为：
//   - 遍历 spec.Submenu 每行每按钮，生成 InlineButton{Text, CallbackData}
//   - CallbackData = "menu:<spec.Path>.row{i}.btn{j}"，超过 64 字节返回 ErrCallbackTooLong
//   - 按钮 Text 为空/全空白时回落为 "(未命名)"
//   - 末尾自动追加一行 "🔙 返回"（callback_data = "menu:back:<parentOfPath(spec.Path)>"）
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

	// 追加返回按钮：单独一行。callback_data 携带父路径（根层 → 空）。
	backData, err := buildBackCallbackData(parentOfPath(spec.Path))
	if err != nil {
		return err
	}
	rows = append(rows, []InlineButton{{Text: submenuBackText, CallbackData: backData}})

	prompt := strings.TrimSpace(spec.Text)
	if prompt == "" {
		prompt = submenuDefaultPrompt
	}

	return d.bot.SendMessageWithInline(ctx, chatID, prompt, rows)
}

// handleEnergyPackageGroup 展开套餐组 Inline Keyboard。
//
// 行为：
//  1. 从 BotAPI.LoadPackagesByIDs 批量加载套餐信息
//  2. 按 SortBy 排序（price_asc 默认 / price_desc / manual，其它值回落 price_asc）
//  3. 对每个套餐用 spec.PackageGroup.TextTemplate 渲染按钮文本
//     （空模板回落 "{name} - {price} TRX"）
//  4. 组装 Inline Keyboard 每行 1 按钮，callback_data = "pkg:<packageId>"
//  5. 末尾追加 "🔙 返回"（callback_data = "menu:back:<parentOfPath(spec.Path)>"），
//     与 submenu 共用返回语义；spec.Path 为空（根菜单直接挂套餐组）时回落 "menu:back:"（返回根）
//
// 错误处理：
//   - LoadPackagesByIDs 返回 error：原样冒泡
//   - 部分 ID 未加载到（DB 中已被删）：跳过缺失项，只展示能加载的
//   - 全部加载失败（返回 nil 或空切片）：发送 packageGroupUnavailableText 纯文本消息，
//     不发 Inline Keyboard，返回 nil
//
// 模板变量上下文（局部，独立于全局白名单）：
//
//	{name}   = PackageInfo.Name
//	{price}  = fmt.Sprintf("%.2f", PackageInfo.Price)
//	{energy} = fmt.Sprintf("%d", PackageInfo.Energy)
//
// 注意：这与任务 6 的全局白名单（{packageName}/{orderNo}/… 由 template.KnownVariables
// 约束）是两套独立上下文。套餐组按钮只在本函数内部生效，未识别的变量（如 {packageName}）
// 会按 template 包规则原样保留。任务 12 接入消息模板时才消费全局白名单。
func (d *Dispatcher) handleEnergyPackageGroup(ctx context.Context, chatID int64, spec ButtonSpec) error {
	if spec.PackageGroup == nil || len(spec.PackageGroup.PackageIDs) == 0 {
		return ErrInvalidPackageGroup
	}
	cfg := spec.PackageGroup

	packages, err := d.bot.LoadPackagesByIDs(ctx, cfg.PackageIDs)
	if err != nil {
		return err
	}

	// 全部缺失：发送纯文本提示，不展开键盘。
	if len(packages) == 0 {
		return d.bot.SendMessage(ctx, chatID, packageGroupUnavailableText, nil)
	}

	// manual：按请求顺序过滤；其他模式：按 Price 稳定排序（未识别值回落 price_asc）。
	if cfg.SortBy == "manual" {
		packages = filterOrderByIDs(packages, cfg.PackageIDs)
	} else {
		sortPackages(packages, cfg.SortBy)
	}

	// 极端情形：manual 过滤后全部缺失（理论上不会进入，因为上面已经对 len(packages) == 0 做了判断；
	// 但 filterOrderByIDs 在 DB 返回了不在 ids 里的脏数据时可能产生空结果，防御性处理）。
	if len(packages) == 0 {
		return d.bot.SendMessage(ctx, chatID, packageGroupUnavailableText, nil)
	}

	rows := make([][]InlineButton, 0, len(packages)+1)
	for _, pkg := range packages {
		rows = append(rows, []InlineButton{{
			Text:         renderPackageButtonText(cfg.TextTemplate, pkg),
			CallbackData: fmt.Sprintf("%s%d", callbackPackagePrefix, pkg.ID),
		}})
	}
	// 套餐组不强校验 spec.Path：根菜单挂载时 Path 可能为空，此时
	// parentOfPath("") 仍为 ""，返回按钮 callback_data = "menu:back:"（返回根）。
	backData, err := buildBackCallbackData(parentOfPath(spec.Path))
	if err != nil {
		return err
	}
	rows = append(rows, []InlineButton{{Text: submenuBackText, CallbackData: backData}})

	return d.bot.SendMessageWithInline(ctx, chatID, packageGroupPrompt, rows)
}

// sortPackages 按 sortBy 就地稳定排序 packages。
//
// 支持值：
//   - "price_asc"：按 Price 升序（默认）
//   - "price_desc"：按 Price 降序
//   - "manual"：不动（由调用方用 filterOrderByIDs 按请求 ids 顺序排列）
//   - 其他（空串、未知字符串）：回落 price_asc
//
// 注意：对于 manual，本函数什么都不做；调用方必须自己调用 filterOrderByIDs。
// 这样拆分是因为 manual 需要 PackageIDs 上下文，而排序契约只拿到 packages 自身。
func sortPackages(packages []PackageInfo, sortBy string) {
	switch sortBy {
	case "manual":
		return
	case "price_desc":
		sort.SliceStable(packages, func(i, j int) bool {
			return packages[i].Price > packages[j].Price
		})
	default:
		// price_asc / 空 / 未知 → 默认升序
		sort.SliceStable(packages, func(i, j int) bool {
			return packages[i].Price < packages[j].Price
		})
	}
}

// renderPackageButtonText 用套餐组局部变量渲染按钮文本。
//
// 变量集合（局部，独立于全局模板白名单）：
//
//	{name}   → pkg.Name
//	{price}  → pkg.Price 格式化为 "%.2f"（TRX 两位小数）
//	{energy} → pkg.Energy（十进制整数）
//
// 空模板回落 packageGroupDefaultTemplate。
// 未识别的变量（例如 {packageName}）由 template.Render 原样保留。
func renderPackageButtonText(tpl string, pkg PackageInfo) string {
	if strings.TrimSpace(tpl) == "" {
		tpl = packageGroupDefaultTemplate
	}
	return template.Render(tpl, map[string]string{
		"name":   pkg.Name,
		"price":  fmt.Sprintf("%.2f", pkg.Price),
		"energy": fmt.Sprintf("%d", pkg.Energy),
	})
}

// filterOrderByIDs 按 ids 给定的顺序从 packages 中挑出对应套餐（用于 manual 排序）。
//
// 行为：
//   - 返回切片顺序严格跟随 ids
//   - ids 中未在 packages 出现的 id 被跳过（部分加载失败的情况）
//   - packages 中不在 ids 的项被丢弃（DB 返回脏数据的防御）
//   - ids 为 nil 或空时返回空切片
func filterOrderByIDs(packages []PackageInfo, ids []int) []PackageInfo {
	if len(ids) == 0 {
		return nil
	}
	byID := make(map[int]PackageInfo, len(packages))
	for _, p := range packages {
		byID[p.ID] = p
	}
	out := make([]PackageInfo, 0, len(ids))
	for _, id := range ids {
		if p, ok := byID[id]; ok {
			out = append(out, p)
		}
	}
	return out
}

// handleAddressManage 展示地址管理面板。
func (d *Dispatcher) handleAddressManage(ctx context.Context, chatID int64, _ ButtonSpec) error {
	return d.bot.ShowAddressManagement(ctx, chatID)
}

// handleWalletQuery 展示钱包查询入口。
func (d *Dispatcher) handleWalletQuery(ctx context.Context, chatID int64, _ ButtonSpec) error {
	return d.bot.ShowWalletQuery(ctx, chatID)
}

// handleOrders 展示订单列表。
//
// 当前实现由 BotAPI.ShowOrders 发送占位消息。订单列表的真实渲染涉及
// 用户订单表查询 + 分页 + 状态文案，不在任务 12（9 场景模板）范围内，
// 待独立任务补齐。
func (d *Dispatcher) handleOrders(ctx context.Context, chatID int64, _ ButtonSpec) error {
	return d.bot.ShowOrders(ctx, chatID)
}
