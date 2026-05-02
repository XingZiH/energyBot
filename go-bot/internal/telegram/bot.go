package telegram

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"ng-antd-admin/go-bot/internal/config"
)

const telegramAPIBase = "https://api.telegram.org"

type Bot struct {
	agentID            int
	token              string
	db                 *pgxpool.Pool
	client             *http.Client
	logger             *log.Logger
	pollingInterval    time.Duration
	orderPaymentTTL    time.Duration
	receiveAddress     string
	tronAPIBaseURL     string
	tronAPIKey         string
	energyProvider     string
	selectedPackageIDs map[int64]int
	pendingAddressOps  map[int64]pendingAddressOperation
	mu                 sync.Mutex
}

type EnergyPackage struct {
	ID            int
	PackageName   string
	EnergyAmount  int
	DurationHours int
	PriceSun      string
	IdlePriceSun  string
	BusyPriceSun  string
}

type UserAddress struct {
	ID             int
	TelegramChatID int64
	Label          string
	Address        string
	IsDefault      bool
}

type WalletSnapshot struct {
	Address                    string
	BalanceSun                 int64
	StakedSun                  int64
	EnergyUsed                 int64
	EnergyLimit                int64
	FreeNetUsed                int64
	FreeNetLimit               int64
	NetUsed                    int64
	NetLimit                   int64
	VotesUsed                  int64
	AcquiredEnergyDelegatedSun int64
	LatestOperationTime        int64
	Activated                  bool
}

type BotDesignerConfig struct {
	WelcomeText   string
	MessageConfig map[string]string
	MenuRows      []DesignerMenuRow
}

type DesignerMenuRow struct {
	ID      string               `json:"id"`
	Buttons []DesignerMenuButton `json:"buttons"`
}

type DesignerMenuButton struct {
	ID      string       `json:"id"`
	Text    string       `json:"text"`
	Action  ButtonAction `json:"action"`
	Style   *ButtonStyle `json:"style,omitempty"`
	URL     string       `json:"url,omitempty"`
	Message string       `json:"message,omitempty"`
	Command string       `json:"command,omitempty"`
	// PackageID 是 v1 遗留字段，v2 已由 PackageGroup 替代。
	// 目前 bot.go 中 v1 解析路径（parseMenuRows 与 executeDesignerButton 的
	// "package" 分支）仍在读此字段。任务 10 完成 v1 路径清理后即可移除。
	PackageID    int                 `json:"packageId,omitempty"`
	Submenu      []DesignerMenuRow   `json:"submenu,omitempty"`
	PackageGroup *PackageGroupConfig `json:"packageGroup,omitempty"`
}

type tronAddressRequest struct {
	Address string `json:"address"`
	Visible bool   `json:"visible"`
}

type tronAccountResponse struct {
	Address             string `json:"address"`
	Balance             int64  `json:"balance"`
	CreateTime          int64  `json:"create_time"`
	LatestOperationTime int64  `json:"latest_opration_time"`
	FreeNetUsage        int64  `json:"free_net_usage"`
	Frozen              []struct {
		FrozenBalance int64 `json:"frozen_balance"`
	} `json:"frozen"`
	FrozenV2 []struct {
		Type   string `json:"type"`
		Amount int64  `json:"amount"`
	} `json:"frozenV2"`
	Votes []struct {
		VoteCount int64 `json:"vote_count"`
	} `json:"votes"`
	AccountResource struct {
		EnergyUsage                               int64 `json:"energy_usage"`
		AcquiredDelegatedFrozenV2BalanceForEnergy int64 `json:"acquired_delegated_frozenV2_balance_for_energy"`
		FrozenBalanceForEnergy                    struct {
			FrozenBalance int64 `json:"frozen_balance"`
		} `json:"frozen_balance_for_energy"`
	} `json:"account_resource"`
}

type tronResourceResponse struct {
	FreeNetUsed  int64 `json:"freeNetUsed"`
	FreeNetLimit int64 `json:"freeNetLimit"`
	NetUsed      int64 `json:"NetUsed"`
	NetLimit     int64 `json:"NetLimit"`
	EnergyUsed   int64 `json:"EnergyUsed"`
	EnergyLimit  int64 `json:"EnergyLimit"`
}

type pendingAddressOperation struct {
	Kind      string
	AddressID int
}

type Update struct {
	UpdateID      int            `json:"update_id"`
	Message       *Message       `json:"message"`
	CallbackQuery *CallbackQuery `json:"callback_query"`
}

type Message struct {
	MessageID int    `json:"message_id"`
	Chat      Chat   `json:"chat"`
	Text      string `json:"text"`
}

type Chat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type CallbackQuery struct {
	ID      string   `json:"id"`
	Message *Message `json:"message"`
	Data    string   `json:"data"`
}

type apiResponse[T any] struct {
	OK          bool   `json:"ok"`
	Result      T      `json:"result"`
	Description string `json:"description"`
}

type inlineKeyboardMarkup struct {
	InlineKeyboard [][]inlineKeyboardButton `json:"inline_keyboard"`
}

type inlineKeyboardButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data"`
}

type replyKeyboardMarkup struct {
	Keyboard              [][]keyboardButton `json:"keyboard"`
	ResizeKeyboard        bool               `json:"resize_keyboard"`
	IsPersistent          bool               `json:"is_persistent,omitempty"`
	InputFieldPlaceholder string             `json:"input_field_placeholder,omitempty"`
}

type keyboardButton struct {
	Text string `json:"text"`
}

const (
	buttonEnergyMenu = "🔥 1小时特价能量"
	buttonAddress    = "📍 地址管理"
	buttonWallet     = "🔎 钱包查询"
	buttonWatchList  = "🔔 监听列表"
	buttonExchange   = "💱 兑换TRX"
	buttonRefresh    = "🔄 刷新套餐"

	maxUserAddresses = 10
)

func NewBot(cfg config.Config, db *pgxpool.Pool, logger *log.Logger) (*Bot, error) {
	return newBot(cfg, db, logger, 0, cfg.TelegramBotToken)
}

func NewAgentBot(cfg config.Config, db *pgxpool.Pool, logger *log.Logger, agentID int, token string) (*Bot, error) {
	if agentID <= 0 {
		return nil, errors.New("agent id is required")
	}
	return newBot(cfg, db, logger, agentID, token)
}

func newBot(cfg config.Config, db *pgxpool.Pool, logger *log.Logger, agentID int, token string) (*Bot, error) {
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("telegram bot token is required")
	}
	if db == nil {
		return nil, errors.New("database pool is required")
	}
	if cfg.TelegramPollingInterval <= 0 {
		return nil, errors.New("telegram polling interval must be positive")
	}
	if logger == nil {
		logger = log.Default()
	}

	return &Bot{
		agentID:            agentID,
		token:              strings.TrimSpace(token),
		db:                 db,
		client:             &http.Client{Timeout: 20 * time.Second},
		logger:             logger,
		pollingInterval:    cfg.TelegramPollingInterval,
		orderPaymentTTL:    cfg.OrderPaymentTTL,
		receiveAddress:     cfg.PlatformReceiveAddress,
		tronAPIBaseURL:     strings.TrimSpace(cfg.TronAPIBaseURL),
		tronAPIKey:         strings.TrimSpace(cfg.TronAPIKey),
		energyProvider:     strings.TrimSpace(cfg.EnergyProvider),
		selectedPackageIDs: map[int64]int{},
		pendingAddressOps:  map[int64]pendingAddressOperation{},
	}, nil
}

func LoadEnabledAgentBots(ctx context.Context, cfg config.Config, db *pgxpool.Pool, logger *log.Logger) ([]*Bot, error) {
	rows, err := db.Query(ctx, `
select c.agent_id, c.telegram_bot_token
from agent_bot_configs c
join agent_profiles p on p.id = c.agent_id
where c.bot_status = 'enabled'
  and c.telegram_bot_token is not null
  and btrim(c.telegram_bot_token) <> ''
  and p.status = 'active'
  and c.deleted_at is null
  and p.deleted_at is null
order by c.agent_id asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var bots []*Bot
	for rows.Next() {
		var agentID int
		var token string
		if err := rows.Scan(&agentID, &token); err != nil {
			return nil, err
		}
		bot, err := NewAgentBot(cfg, db, logger, agentID, token)
		if err != nil {
			return nil, err
		}
		bots = append(bots, bot)
	}
	return bots, rows.Err()
}

func (b *Bot) agentIDParam() any {
	if b.agentID > 0 {
		return b.agentID
	}
	return nil
}

func (b *Bot) Run(ctx context.Context) error {
	for {
		if err := b.deleteWebhook(ctx); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			b.logger.Printf("telegram deleteWebhook failed: %s", redactTelegramToken(err.Error(), b.token))
			if err := sleepOrDone(ctx, b.pollingInterval); err != nil {
				return err
			}
			continue
		}
		break
	}

	b.logger.Println("telegram polling started")
	offset := 0
	for {
		updates, err := b.getUpdates(ctx, offset)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			b.logger.Printf("telegram getUpdates failed: %s", redactTelegramToken(err.Error(), b.token))
			if err := sleepOrDone(ctx, b.pollingInterval); err != nil {
				return err
			}
			continue
		}

		for _, update := range updates {
			if update.UpdateID >= offset {
				offset = update.UpdateID + 1
			}
			if err := b.handleUpdate(ctx, update); err != nil {
				b.logger.Printf("telegram handle update %d failed: %v", update.UpdateID, err)
			}
		}

		if err := sleepOrDone(ctx, b.pollingInterval); err != nil {
			return err
		}
	}
}

func (b *Bot) handleUpdate(ctx context.Context, update Update) error {
	if update.CallbackQuery != nil {
		return b.handleCallback(ctx, *update.CallbackQuery)
	}
	if update.Message != nil {
		return b.handleMessage(ctx, *update.Message)
	}
	return nil
}

func (b *Bot) handleMessage(ctx context.Context, message Message) error {
	text := strings.TrimSpace(message.Text)
	walletAddress, isWalletAddressQuery := parseWalletQueryAddress(text)
	switch {
	case b.hasPendingAddressOperation(message.Chat.ID):
		if !looksLikeTronAddress(text) {
			return b.sendMessage(ctx, message.Chat.ID, "请输入有效的 TRON 地址，地址必须以 T 开头。", nil)
		}
		return b.handleAddressInput(ctx, message.Chat.ID, text)
	case isMenuCommand(text):
		return b.sendPackageMenu(ctx, message.Chat.ID)
	case b.handleCustomMenuButton(ctx, message.Chat.ID, text):
		return nil
	case isAddressButton(text):
		return b.sendAddressManagement(ctx, message.Chat.ID)
	case isWalletButton(text):
		return b.sendWalletQueryMenu(ctx, message.Chat.ID)
	case isWatchListButton(text):
		return b.sendMessage(ctx, message.Chat.ID, "🔔 监听列表正在接入支付确认与归还任务，后续会展示待支付、已到账、待归还订单。", nil)
	case isExchangeButton(text):
		return b.sendMessage(ctx, message.Chat.ID, "💱 兑换 TRX 暂未开放，请先使用 TRX 支付能量租赁订单。", nil)
	case isRefreshButton(text):
		return b.sendPackageMenu(ctx, message.Chat.ID)
	case isWalletAddressQuery:
		return b.sendWalletSnapshot(ctx, message.Chat.ID, walletAddress, "", 0)
	case b.handlePackageButton(ctx, message.Chat.ID, text):
		return nil
	default:
		return b.sendMessage(ctx, message.Chat.ID, "请点击下方按钮选择套餐，或发送 /start 打开菜单。", nil)
	}
}

func (b *Bot) handleCallback(ctx context.Context, query CallbackQuery) error {
	if query.Message == nil {
		return b.answerCallback(ctx, query.ID, "消息已失效")
	}

	chatID := query.Message.Chat.ID
	switch {
	case query.Data == "refresh":
		if err := b.answerCallback(ctx, query.ID, "已刷新套餐"); err != nil {
			return err
		}
		return b.sendPackageMenu(ctx, chatID)
	case query.Data == "wallet:menu":
		if err := b.answerCallback(ctx, query.ID, "钱包查询"); err != nil {
			return err
		}
		return b.sendWalletQueryMenu(ctx, chatID)
	case strings.HasPrefix(query.Data, "wallet:addr:"):
		addressID, err := parseCallbackID(query.Data, "wallet:addr:")
		if err != nil {
			_ = b.answerCallback(ctx, query.ID, "地址无效")
			return nil
		}
		address, err := b.findUserAddress(ctx, chatID, addressID)
		if err != nil {
			_ = b.answerCallback(ctx, query.ID, "地址不存在")
			return nil
		}
		if err := b.answerCallback(ctx, query.ID, "正在查询链上数据"); err != nil {
			return err
		}
		return b.sendWalletSnapshot(ctx, chatID, address.Address, address.Label, address.ID)
	case query.Data == "addr:menu":
		if err := b.answerCallback(ctx, query.ID, "地址管理"); err != nil {
			return err
		}
		return b.sendAddressManagement(ctx, chatID)
	case query.Data == "addr:add":
		b.setPendingAddressOperation(chatID, pendingAddressOperation{Kind: "add"})
		if err := b.answerCallback(ctx, query.ID, "请发送地址"); err != nil {
			return err
		}
		return b.sendMessage(ctx, chatID, "➕ 请发送要绑定的 TRON 地址。\n\n地址必须以 T 开头，每个用户最多绑定 10 个。", nil)
	case strings.HasPrefix(query.Data, "addr:edit:"):
		addressID, err := parseCallbackID(query.Data, "addr:edit:")
		if err != nil {
			_ = b.answerCallback(ctx, query.ID, "地址无效")
			return nil
		}
		b.setPendingAddressOperation(chatID, pendingAddressOperation{Kind: "edit", AddressID: addressID})
		if err := b.answerCallback(ctx, query.ID, "请发送新地址"); err != nil {
			return err
		}
		return b.sendMessage(ctx, chatID, "✏️ 请发送新的 TRON 地址，发送后会替换当前绑定地址。", nil)
	case strings.HasPrefix(query.Data, "addr:del:"):
		addressID, err := parseCallbackID(query.Data, "addr:del:")
		if err != nil {
			_ = b.answerCallback(ctx, query.ID, "地址无效")
			return nil
		}
		if err := b.deleteUserAddress(ctx, chatID, addressID); err != nil {
			return err
		}
		if err := b.answerCallback(ctx, query.ID, "已删除地址"); err != nil {
			return err
		}
		return b.sendAddressManagement(ctx, chatID)
	case strings.HasPrefix(query.Data, "addr:default:"):
		addressID, err := parseCallbackID(query.Data, "addr:default:")
		if err != nil {
			_ = b.answerCallback(ctx, query.ID, "地址无效")
			return nil
		}
		if err := b.setDefaultUserAddress(ctx, chatID, addressID); err != nil {
			return err
		}
		if err := b.answerCallback(ctx, query.ID, "已设为默认地址"); err != nil {
			return err
		}
		return b.sendAddressManagement(ctx, chatID)
	case strings.HasPrefix(query.Data, "order:"):
		packageID, addressID, err := parseOrderCallback(query.Data)
		if err != nil {
			_ = b.answerCallback(ctx, query.ID, "下单参数无效")
			return nil
		}
		address, err := b.findUserAddress(ctx, chatID, addressID)
		if err != nil {
			_ = b.answerCallback(ctx, query.ID, "地址不存在")
			return nil
		}
		order, err := b.createOrder(ctx, packageID, address.Address, chatID)
		if err != nil {
			return err
		}
		if err := b.answerCallback(ctx, query.ID, "支付订单已生成"); err != nil {
			return err
		}
		packages, _ := b.listPackages(ctx)
		return b.sendMessage(ctx, chatID, order.PaymentText, mainReplyKeyboard(packages))
	case strings.HasPrefix(query.Data, "pkg:"):
		rawID := strings.TrimPrefix(query.Data, "pkg:")
		packageID, err := strconv.Atoi(rawID)
		if err != nil {
			_ = b.answerCallback(ctx, query.ID, "套餐无效")
			return nil
		}
		pkg, err := b.findPackage(ctx, packageID)
		if err != nil {
			_ = b.answerCallback(ctx, query.ID, "套餐不存在")
			return nil
		}
		if err := b.answerCallback(ctx, query.ID, "请选择接收地址"); err != nil {
			return err
		}
		return b.sendAddressSelection(ctx, chatID, pkg)
	default:
		return b.answerCallback(ctx, query.ID, "未知操作")
	}
}

func (b *Bot) sendPackageMenu(ctx context.Context, chatID int64) error {
	packages, err := b.listPackages(ctx)
	if err != nil {
		return err
	}
	designerConfig, _ := b.loadDesignerConfig(ctx)
	if len(packages) == 0 {
		text := designerConfig.MessageConfig["noPackage"]
		if strings.TrimSpace(text) == "" {
			text = "当前没有启用的能量套餐，请联系管理员。"
		}
		return b.sendMessage(ctx, chatID, text, designerConfig.replyKeyboard(packages))
	}
	if designerConfig.hasCustomMenu() {
		text := strings.TrimSpace(designerConfig.WelcomeText)
		if text == "" {
			text = packageMenuText(packages, b.orderPaymentTTL)
		}
		return b.sendMessage(ctx, chatID, text, designerConfig.replyKeyboard(packages))
	}

	return b.sendMessage(ctx, chatID, packageMenuText(packages, b.orderPaymentTTL), mainReplyKeyboard(packages))
}

func (b *Bot) handleCustomMenuButton(ctx context.Context, chatID int64, text string) bool {
	designerConfig, err := b.loadDesignerConfig(ctx)
	if err != nil || !designerConfig.hasCustomMenu() {
		return false
	}
	button, ok := designerConfig.findButton(text, b.packageButtonTextByID(ctx))
	if !ok {
		return false
	}
	if err := b.executeDesignerButton(ctx, chatID, button); err != nil {
		b.logger.Printf("execute designer button failed: %v", err)
	}
	return true
}

func (b *Bot) executeDesignerButton(ctx context.Context, chatID int64, button DesignerMenuButton) error {
	switch strings.TrimSpace(string(button.Action)) {
	case "package":
		if button.PackageID <= 0 {
			return b.sendPackageMenu(ctx, chatID)
		}
		pkg, err := b.findPackage(ctx, button.PackageID)
		if err != nil {
			return b.sendMessage(ctx, chatID, "套餐不存在或已下架，请重新选择。", nil)
		}
		return b.sendAddressSelection(ctx, chatID, pkg)
	case "address":
		return b.sendAddressManagement(ctx, chatID)
	case "wallet":
		return b.sendWalletQueryMenu(ctx, chatID)
	case "text":
		message := strings.TrimSpace(button.Message)
		if message == "" {
			message = "已收到。"
		}
		return b.sendMessage(ctx, chatID, message, nil)
	case "url":
		url := strings.TrimSpace(button.URL)
		if url == "" {
			url = "链接暂未配置。"
		}
		return b.sendMessage(ctx, chatID, url, nil)
	case "start", "refresh":
		return b.sendPackageMenu(ctx, chatID)
	default:
		if strings.TrimSpace(button.Command) == "/start" {
			return b.sendPackageMenu(ctx, chatID)
		}
		return b.sendMessage(ctx, chatID, "暂不支持该按钮动作。", nil)
	}
}

func (b *Bot) handlePackageButton(ctx context.Context, chatID int64, text string) bool {
	packages, err := b.listPackages(ctx)
	if err != nil {
		b.logger.Printf("list packages for keyboard button failed: %v", err)
		return false
	}

	for _, pkg := range packages {
		if strings.EqualFold(strings.TrimSpace(text), packageButtonText(pkg)) {
			if err := b.sendAddressSelection(ctx, chatID, pkg); err != nil {
				b.logger.Printf("send address selection failed: %v", err)
			}
			return true
		}
	}
	return false
}

func (b *Bot) packageButtonTextByID(ctx context.Context) map[int]string {
	packages, err := b.listPackages(ctx)
	if err != nil {
		return nil
	}
	result := make(map[int]string, len(packages))
	for _, pkg := range packages {
		result[pkg.ID] = packageButtonText(pkg)
	}
	return result
}

func (b *Bot) loadDesignerConfig(ctx context.Context) (BotDesignerConfig, error) {
	var welcomeText, messageConfigRaw, menuConfigRaw string
	var err error
	if b.agentID > 0 {
		err = b.db.QueryRow(ctx, `
select coalesce(welcome_text, ''), coalesce(message_config, ''), coalesce(menu_config, '')
from agent_bot_configs
where agent_id = $1
  and deleted_at is null
limit 1`, b.agentID).Scan(&welcomeText, &messageConfigRaw, &menuConfigRaw)
	} else {
		err = b.db.QueryRow(ctx, `
select coalesce(welcome_text, ''), coalesce(message_config, ''), coalesce(menu_config, '')
from energy_platform_config
where id = 1
  and deleted_at is null
limit 1`).Scan(&welcomeText, &messageConfigRaw, &menuConfigRaw)
	}
	if err != nil {
		return BotDesignerConfig{}, err
	}
	config := BotDesignerConfig{
		WelcomeText:   strings.TrimSpace(welcomeText),
		MessageConfig: parseMessageConfig(messageConfigRaw),
		MenuRows:      parseMenuRows(menuConfigRaw),
	}
	return config, nil
}

func (b *Bot) sendAddressSelection(ctx context.Context, chatID int64, pkg EnergyPackage) error {
	addresses, err := b.listUserAddresses(ctx, chatID)
	if err != nil {
		return err
	}
	packages, _ := b.listPackages(ctx)
	return b.sendMessage(ctx, chatID, addressSelectionText(pkg, addresses), addressSelectionKeyboard(pkg.ID, addresses, mainReplyKeyboard(packages)))
}

func (b *Bot) sendAddressManagement(ctx context.Context, chatID int64) error {
	addresses, err := b.listUserAddresses(ctx, chatID)
	if err != nil {
		return err
	}
	return b.sendMessage(ctx, chatID, addressManagementText(addresses), addressManagementKeyboard(addresses))
}

func (b *Bot) sendWalletQueryMenu(ctx context.Context, chatID int64) error {
	addresses, err := b.listUserAddresses(ctx, chatID)
	if err != nil {
		return err
	}
	return b.sendMessage(ctx, chatID, walletQueryMenuText(addresses), walletQueryKeyboard(addresses))
}

func (b *Bot) sendWalletSnapshot(ctx context.Context, chatID int64, address string, label string, addressID int) error {
	snapshot, err := b.fetchWalletSnapshot(ctx, address)
	if err != nil {
		b.logger.Printf("wallet query failed: address=%s error=%v", shortAddress(address), err)
		return b.sendMessage(ctx, chatID, "钱包查询失败：链上数据暂时不可用，请稍后重试。", nil)
	}
	return b.sendMessage(ctx, chatID, walletSnapshotText(snapshot, label), walletResultKeyboard(addressID))
}

func (b *Bot) listPackages(ctx context.Context) ([]EnergyPackage, error) {
	rows, err := b.db.Query(ctx, `
select p.id,
       p.package_name,
       coalesce(base.energy_amount, p.energy_amount),
       coalesce(base.duration_hours, p.duration_hours),
       p.price_sun::text,
       coalesce(p.idle_price_sun, p.price_sun)::text,
       coalesce(p.busy_price_sun, p.price_sun)::text
from energy_packages p
left join energy_packages base on base.id = p.platform_package_id and base.deleted_at is null
where p.status = 'active'
  and p.deleted_at is null
  and (
    ($1::integer is null and p.package_kind = 'admin_package' and p.agent_id is null)
    or ($1::integer is not null and p.package_kind = 'user_package' and p.agent_id is not distinct from $1::integer and coalesce(base.status, 'active') = 'active')
  )
order by p.sort_order asc, p.id asc`, b.agentIDParam())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var packages []EnergyPackage
	for rows.Next() {
		var pkg EnergyPackage
		if err := rows.Scan(&pkg.ID, &pkg.PackageName, &pkg.EnergyAmount, &pkg.DurationHours, &pkg.PriceSun, &pkg.IdlePriceSun, &pkg.BusyPriceSun); err != nil {
			return nil, err
		}
		pkg.PriceSun = currentPackagePriceSun(pkg, time.Now())
		packages = append(packages, pkg)
	}
	return packages, rows.Err()
}

func (b *Bot) findPackage(ctx context.Context, id int) (EnergyPackage, error) {
	var pkg EnergyPackage
	err := b.db.QueryRow(ctx, `
select p.id,
       p.package_name,
       coalesce(base.energy_amount, p.energy_amount),
       coalesce(base.duration_hours, p.duration_hours),
       p.price_sun::text,
       coalesce(p.idle_price_sun, p.price_sun)::text,
       coalesce(p.busy_price_sun, p.price_sun)::text
from energy_packages p
left join energy_packages base on base.id = p.platform_package_id and base.deleted_at is null
where p.id = $1
  and p.status = 'active'
  and p.deleted_at is null
  and (
    ($2::integer is null and p.package_kind = 'admin_package' and p.agent_id is null)
    or ($2::integer is not null and p.package_kind = 'user_package' and p.agent_id is not distinct from $2::integer and coalesce(base.status, 'active') = 'active')
  )`, id, b.agentIDParam()).
		Scan(&pkg.ID, &pkg.PackageName, &pkg.EnergyAmount, &pkg.DurationHours, &pkg.PriceSun, &pkg.IdlePriceSun, &pkg.BusyPriceSun)
	if err != nil {
		return EnergyPackage{}, err
	}
	pkg.PriceSun = currentPackagePriceSun(pkg, time.Now())
	return pkg, nil
}

func (b *Bot) listUserAddresses(ctx context.Context, chatID int64) ([]UserAddress, error) {
	rows, err := b.db.Query(ctx, `
select id, telegram_chat_id, label, address, is_default
from energy_user_addresses
where telegram_chat_id = $1
  and agent_id is not distinct from $2
  and status = 'active'
  and deleted_at is null
order by is_default desc, id asc`, chatID, b.agentIDParam())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var addresses []UserAddress
	for rows.Next() {
		var item UserAddress
		if err := rows.Scan(&item.ID, &item.TelegramChatID, &item.Label, &item.Address, &item.IsDefault); err != nil {
			return nil, err
		}
		addresses = append(addresses, item)
	}
	return addresses, rows.Err()
}

func (b *Bot) findUserAddress(ctx context.Context, chatID int64, addressID int) (UserAddress, error) {
	var item UserAddress
	err := b.db.QueryRow(ctx, `
select id, telegram_chat_id, label, address, is_default
from energy_user_addresses
where id = $1
  and telegram_chat_id = $2
  and agent_id is not distinct from $3
  and status = 'active'
  and deleted_at is null`, addressID, chatID, b.agentIDParam()).
		Scan(&item.ID, &item.TelegramChatID, &item.Label, &item.Address, &item.IsDefault)
	if err != nil {
		return UserAddress{}, err
	}
	return item, nil
}

func (b *Bot) createUserAddress(ctx context.Context, chatID int64, address string) error {
	address = strings.TrimSpace(address)
	addresses, err := b.listUserAddresses(ctx, chatID)
	if err != nil {
		return err
	}
	if len(addresses) >= maxUserAddresses {
		return fmt.Errorf("user address limit reached")
	}
	for _, item := range addresses {
		if strings.EqualFold(item.Address, address) {
			return fmt.Errorf("address already exists")
		}
	}

	isDefault := len(addresses) == 0
	label := fmt.Sprintf("地址%d", len(addresses)+1)
	_, err = b.db.Exec(ctx, `
insert into energy_user_addresses (
  agent_id, telegram_chat_id, label, address, is_default, status, created_at, updated_at
) values ($1, $2, $3, $4, $5, 'active', $6, $6)`, b.agentIDParam(), chatID, label, address, isDefault, time.Now())
	return err
}

func (b *Bot) updateUserAddress(ctx context.Context, chatID int64, addressID int, address string) error {
	address = strings.TrimSpace(address)
	addresses, err := b.listUserAddresses(ctx, chatID)
	if err != nil {
		return err
	}
	found := false
	for _, item := range addresses {
		if item.ID == addressID {
			found = true
			continue
		}
		if strings.EqualFold(item.Address, address) {
			return fmt.Errorf("address already exists")
		}
	}
	if !found {
		return fmt.Errorf("address not found")
	}

	tag, err := b.db.Exec(ctx, `
update energy_user_addresses
set address = $1, updated_at = $2
where id = $3
  and telegram_chat_id = $4
  and agent_id is not distinct from $5
  and status = 'active'
  and deleted_at is null`, address, time.Now(), addressID, chatID, b.agentIDParam())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("address not found")
	}
	return nil
}

func (b *Bot) deleteUserAddress(ctx context.Context, chatID int64, addressID int) error {
	address, err := b.findUserAddress(ctx, chatID, addressID)
	if err != nil {
		return err
	}
	now := time.Now()
	tag, err := b.db.Exec(ctx, `
update energy_user_addresses
set status = 'deleted', deleted_at = $1, updated_at = $1, is_default = false
where id = $2
  and telegram_chat_id = $3
  and agent_id is not distinct from $4
  and status = 'active'
  and deleted_at is null`, now, addressID, chatID, b.agentIDParam())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("address not found")
	}
	if address.IsDefault {
		_, _ = b.db.Exec(ctx, `
update energy_user_addresses
set is_default = true, updated_at = $1
where id = (
  select id from energy_user_addresses
  where telegram_chat_id = $2
    and agent_id is not distinct from $3
    and status = 'active'
    and deleted_at is null
  order by id asc
  limit 1
)`, now, chatID, b.agentIDParam())
	}
	return nil
}

func (b *Bot) setDefaultUserAddress(ctx context.Context, chatID int64, addressID int) error {
	if _, err := b.findUserAddress(ctx, chatID, addressID); err != nil {
		return err
	}
	now := time.Now()
	_, err := b.db.Exec(ctx, `
update energy_user_addresses
set is_default = case when id = $1 then true else false end,
    updated_at = $2
where telegram_chat_id = $3
  and agent_id is not distinct from $4
  and status = 'active'
  and deleted_at is null`, addressID, now, chatID, b.agentIDParam())
	return err
}

func (b *Bot) fetchWalletSnapshot(ctx context.Context, address string) (WalletSnapshot, error) {
	address = strings.TrimSpace(address)
	if !looksLikeTronAddress(address) {
		return WalletSnapshot{}, fmt.Errorf("invalid tron address")
	}

	request := tronAddressRequest{Address: address, Visible: true}
	var account tronAccountResponse
	if err := b.postTronJSON(ctx, "wallet/getaccount", request, &account); err != nil {
		return WalletSnapshot{}, err
	}

	var resource tronResourceResponse
	if err := b.postTronJSON(ctx, "wallet/getaccountresource", request, &resource); err != nil {
		return WalletSnapshot{}, err
	}

	return buildWalletSnapshot(address, account, resource), nil
}

func (b *Bot) postTronJSON(ctx context.Context, path string, payload any, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	baseURL := strings.TrimRight(b.tronAPIBaseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.trongrid.io"
	}
	endpoint := baseURL + "/" + strings.TrimLeft(path, "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(b.tronAPIKey) != "" {
		req.Header.Set("TRON-PRO-API-KEY", strings.TrimSpace(b.tronAPIKey))
	}

	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("tron %s failed: %s %s", path, resp.Status, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(resp.Body).Decode(result)
}

func buildWalletSnapshot(address string, account tronAccountResponse, resource tronResourceResponse) WalletSnapshot {
	energyUsed := resource.EnergyUsed
	if energyUsed == 0 && account.AccountResource.EnergyUsage > 0 {
		energyUsed = account.AccountResource.EnergyUsage
	}

	freeNetUsed := resource.FreeNetUsed
	if freeNetUsed == 0 && account.FreeNetUsage > 0 {
		freeNetUsed = account.FreeNetUsage
	}

	return WalletSnapshot{
		Address:                    address,
		BalanceSun:                 account.Balance,
		StakedSun:                  stakedSunFromAccount(account),
		EnergyUsed:                 energyUsed,
		EnergyLimit:                resource.EnergyLimit,
		FreeNetUsed:                freeNetUsed,
		FreeNetLimit:               resource.FreeNetLimit,
		NetUsed:                    resource.NetUsed,
		NetLimit:                   resource.NetLimit,
		VotesUsed:                  votesFromAccount(account),
		AcquiredEnergyDelegatedSun: account.AccountResource.AcquiredDelegatedFrozenV2BalanceForEnergy,
		LatestOperationTime:        account.LatestOperationTime,
		Activated:                  strings.TrimSpace(account.Address) != "",
	}
}

func stakedSunFromAccount(account tronAccountResponse) int64 {
	var total int64
	for _, item := range account.Frozen {
		total += item.FrozenBalance
	}
	total += account.AccountResource.FrozenBalanceForEnergy.FrozenBalance
	for _, item := range account.FrozenV2 {
		total += item.Amount
	}
	return total
}

func votesFromAccount(account tronAccountResponse) int64 {
	var total int64
	for _, vote := range account.Votes {
		total += vote.VoteCount
	}
	return total
}

type createdOrder struct {
	OrderNo     string
	PaymentText string
}

type createdOrderDetail struct {
	OrderNo         string
	PackageName     string
	EnergyAmount    int
	DurationHours   int
	PriceSun        string
	ReceiveAddress  string
	ReceiverAddress string
	TTL             time.Duration
}

func (b *Bot) createOrder(ctx context.Context, packageID int, receiverAddress string, chatID int64) (createdOrder, error) {
	pkg, err := b.findPackage(ctx, packageID)
	if err != nil {
		return createdOrder{}, err
	}

	now := time.Now()
	orderNo := newOrderNo(now)
	expiresAt := now.Add(b.orderPaymentTTL)
	_, err = b.db.Exec(ctx, `
insert into energy_orders (
  agent_id, order_no, package_id, package_name, buyer_address, receiver_address,
  energy_amount, duration_hours, payment_amount_sun, payment_expires_at,
  status, return_status, energy_provider, remark, created_at, updated_at
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', 'none', $11, $12, $13, $13)`,
		b.agentIDParam(),
		orderNo,
		pkg.ID,
		pkg.PackageName,
		"",
		receiverAddress,
		pkg.EnergyAmount,
		pkg.DurationHours,
		pkg.PriceSun,
		expiresAt,
		b.energyProvider,
		fmt.Sprintf("telegram_chat_id=%d", chatID),
		now,
	)
	if err != nil {
		return createdOrder{}, err
	}

	text := paymentOrderText(createdOrderDetail{
		OrderNo:         orderNo,
		PackageName:     pkg.PackageName,
		EnergyAmount:    pkg.EnergyAmount,
		DurationHours:   pkg.DurationHours,
		PriceSun:        pkg.PriceSun,
		ReceiveAddress:  b.receiveAddress,
		ReceiverAddress: receiverAddress,
		TTL:             b.orderPaymentTTL,
	})

	return createdOrder{OrderNo: orderNo, PaymentText: text}, nil
}

func (b *Bot) handleAddressInput(ctx context.Context, chatID int64, address string) error {
	op, ok := b.pendingAddressOperation(chatID)
	if !ok {
		return b.sendMessage(ctx, chatID, "请先点击「📍 地址管理」里的添加或修改按钮。", nil)
	}

	var err error
	switch op.Kind {
	case "add":
		err = b.createUserAddress(ctx, chatID, address)
	case "edit":
		err = b.updateUserAddress(ctx, chatID, op.AddressID, address)
	default:
		err = fmt.Errorf("unknown address operation")
	}
	if err != nil {
		switch err.Error() {
		case "user address limit reached":
			return b.sendMessage(ctx, chatID, "地址已满：每个用户最多只能绑定 10 个地址，请先删除不用的地址。", nil)
		case "address already exists":
			return b.sendMessage(ctx, chatID, "这个地址已经绑定过了，请换一个地址。", nil)
		case "address not found":
			b.clearPendingAddressOperation(chatID)
			return b.sendMessage(ctx, chatID, "要修改的地址不存在，请重新进入地址管理。", nil)
		default:
			return err
		}
	}

	b.clearPendingAddressOperation(chatID)
	if op.Kind == "add" {
		_ = b.sendMessage(ctx, chatID, "✅ 地址已添加。", nil)
	} else {
		_ = b.sendMessage(ctx, chatID, "✅ 地址已更新。", nil)
	}
	return b.sendAddressManagement(ctx, chatID)
}

func (b *Bot) getUpdates(ctx context.Context, offset int) ([]Update, error) {
	payload := map[string]any{
		"offset":          offset,
		"limit":           50,
		"timeout":         0,
		"allowed_updates": []string{"message", "callback_query"},
	}
	var updates []Update
	if err := b.call(ctx, "getUpdates", payload, &updates); err != nil {
		return nil, err
	}
	return updates, nil
}

func (b *Bot) sendMessage(ctx context.Context, chatID int64, text string, markup any) error {
	_, err := b.sendMessageResult(ctx, chatID, text, markup)
	return err
}

func (b *Bot) sendMessageResult(ctx context.Context, chatID int64, text string, markup any) (Message, error) {
	payload := map[string]any{
		"chat_id":                  chatID,
		"text":                     text,
		"disable_web_page_preview": true,
	}
	if markup != nil {
		payload["reply_markup"] = markup
	}
	var result Message
	return result, b.call(ctx, "sendMessage", payload, &result)
}

func (b *Bot) answerCallback(ctx context.Context, callbackID string, text string) error {
	payload := map[string]any{
		"callback_query_id": callbackID,
		"text":              text,
		"show_alert":        false,
	}
	var result bool
	return b.call(ctx, "answerCallbackQuery", payload, &result)
}

func (b *Bot) deleteWebhook(ctx context.Context) error {
	payload := map[string]any{"drop_pending_updates": false}
	var result bool
	return b.call(ctx, "deleteWebhook", payload, &result)
}

func (b *Bot) call(ctx context.Context, method string, payload any, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/bot%s/%s", telegramAPIBase, b.token, method), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		return errors.New(redactTelegramToken(err.Error(), b.token))
	}
	defer resp.Body.Close()

	var apiResp apiResponse[json.RawMessage]
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return err
	}
	if !apiResp.OK {
		if apiResp.Description == "" {
			apiResp.Description = resp.Status
		}
		return fmt.Errorf("telegram %s failed: %s", method, apiResp.Description)
	}
	if result == nil {
		return nil
	}
	return json.Unmarshal(apiResp.Result, result)
}

func (b *Bot) setSelectedPackageID(chatID int64, packageID int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.selectedPackageIDs[chatID] = packageID
}

func (b *Bot) selectedPackageID(chatID int64) (int, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	packageID, ok := b.selectedPackageIDs[chatID]
	return packageID, ok
}

func (b *Bot) clearSelectedPackageID(chatID int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.selectedPackageIDs, chatID)
}

func (b *Bot) setPendingAddressOperation(chatID int64, op pendingAddressOperation) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pendingAddressOps[chatID] = op
}

func (b *Bot) pendingAddressOperation(chatID int64) (pendingAddressOperation, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	op, ok := b.pendingAddressOps[chatID]
	return op, ok
}

func (b *Bot) hasPendingAddressOperation(chatID int64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	_, ok := b.pendingAddressOps[chatID]
	return ok
}

func (b *Bot) clearPendingAddressOperation(chatID int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.pendingAddressOps, chatID)
}

func isMenuCommand(text string) bool {
	switch strings.TrimSpace(text) {
	case "/start", "/menu", "菜单", buttonEnergyMenu, "🔥1小时特价能量🔥":
		return true
	default:
		return false
	}
}

func isAddressButton(text string) bool {
	switch strings.TrimSpace(text) {
	case buttonAddress:
		return true
	default:
		return false
	}
}

func isWalletButton(text string) bool {
	switch strings.TrimSpace(text) {
	case buttonWallet, "🔎钱包查询":
		return true
	default:
		return false
	}
}

func isWatchListButton(text string) bool {
	switch strings.TrimSpace(text) {
	case buttonWatchList, "🔔监听列表":
		return true
	default:
		return false
	}
}

func isExchangeButton(text string) bool {
	switch strings.TrimSpace(text) {
	case buttonExchange, "兑换TRX":
		return true
	default:
		return false
	}
}

func isRefreshButton(text string) bool {
	switch strings.TrimSpace(text) {
	case buttonRefresh, "刷新套餐":
		return true
	default:
		return false
	}
}

func mainReplyKeyboard(packages []EnergyPackage) *replyKeyboardMarkup {
	rows := [][]keyboardButton{
		{{Text: buttonEnergyMenu}},
		{{Text: buttonAddress}, {Text: buttonWallet}},
		{{Text: buttonWatchList}, {Text: buttonExchange}},
	}

	packageButtons := make([]keyboardButton, 0, len(packages))
	for _, pkg := range packages {
		if strings.TrimSpace(pkg.PackageName) == "" {
			continue
		}
		packageButtons = append(packageButtons, keyboardButton{Text: packageButtonText(pkg)})
		if len(packageButtons) == 2 {
			rows = append(rows, packageButtons)
			packageButtons = nil
		}
	}
	if len(packageButtons) > 0 {
		rows = append(rows, packageButtons)
	}
	rows = append(rows, []keyboardButton{{Text: buttonRefresh}})

	return &replyKeyboardMarkup{
		Keyboard:              rows,
		ResizeKeyboard:        true,
		IsPersistent:          true,
		InputFieldPlaceholder: "请输入接收能量的 TRON 地址",
	}
}

func (c BotDesignerConfig) hasCustomMenu() bool {
	for _, row := range c.MenuRows {
		if len(row.Buttons) > 0 {
			return true
		}
	}
	return false
}

func (c BotDesignerConfig) replyKeyboard(packages []EnergyPackage) *replyKeyboardMarkup {
	if !c.hasCustomMenu() {
		return mainReplyKeyboard(packages)
	}
	packageTextByID := make(map[int]string, len(packages))
	for _, pkg := range packages {
		packageTextByID[pkg.ID] = packageButtonText(pkg)
	}
	rows := make([][]keyboardButton, 0, len(c.MenuRows))
	for _, menuRow := range c.MenuRows {
		row := make([]keyboardButton, 0, len(menuRow.Buttons))
		for _, button := range menuRow.Buttons {
			text := designerButtonText(button, packageTextByID)
			if text == "" {
				continue
			}
			row = append(row, keyboardButton{Text: text})
		}
		if len(row) > 0 {
			rows = append(rows, row)
		}
	}
	if len(rows) == 0 {
		return mainReplyKeyboard(packages)
	}
	return &replyKeyboardMarkup{
		Keyboard:              rows,
		ResizeKeyboard:        true,
		IsPersistent:          true,
		InputFieldPlaceholder: "请输入接收能量的 TRON 地址",
	}
}

func (c BotDesignerConfig) findButton(text string, packageTextByID map[int]string) (DesignerMenuButton, bool) {
	text = strings.TrimSpace(text)
	for _, row := range c.MenuRows {
		for _, button := range row.Buttons {
			if strings.EqualFold(text, designerButtonText(button, packageTextByID)) {
				return button, true
			}
		}
	}
	return DesignerMenuButton{}, false
}

func designerButtonText(button DesignerMenuButton, packageTextByID map[int]string) string {
	text := strings.TrimSpace(button.Text)
	if text != "" {
		return text
	}
	if strings.TrimSpace(string(button.Action)) == "package" && button.PackageID > 0 {
		if packageTextByID != nil {
			if packageText := strings.TrimSpace(packageTextByID[button.PackageID]); packageText != "" {
				return packageText
			}
		}
		return fmt.Sprintf("套餐 %d", button.PackageID)
	}
	switch strings.TrimSpace(string(button.Action)) {
	case "address":
		return buttonAddress
	case "wallet":
		return buttonWallet
	case "text":
		return "提示"
	case "url":
		return "链接"
	case "start":
		return "首页"
	case "refresh":
		return buttonRefresh
	default:
		return ""
	}
}

func parseMessageConfig(raw string) map[string]string {
	config := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return config
	}
	_ = json.Unmarshal([]byte(raw), &config)
	return config
}

func parseMenuRows(raw string) []DesignerMenuRow {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var rows []DesignerMenuRow
	if err := json.Unmarshal([]byte(raw), &rows); err == nil {
		return rows
	}
	var buttons []DesignerMenuButton
	if err := json.Unmarshal([]byte(raw), &buttons); err != nil {
		return nil
	}
	legacyRows := make([]DesignerMenuRow, 0, len(buttons))
	for _, button := range buttons {
		legacyRows = append(legacyRows, DesignerMenuRow{Buttons: []DesignerMenuButton{button}})
	}
	return legacyRows
}

func packageButtonText(pkg EnergyPackage) string {
	return strings.TrimSpace(pkg.PackageName)
}

func packageMenuText(packages []EnergyPackage, ttl time.Duration) string {
	lines := []string{
		"💚 1小时能量自动租赁",
		"",
		"📌 当前可选套餐",
	}
	for _, pkg := range packages {
		lines = append(lines, fmt.Sprintf("⚡ %s", pkg.PackageName))
		lines = append(lines, fmt.Sprintf("   🔋 %d 能量  ⏱ %d小时  💰 %s TRX", pkg.EnergyAmount, pkg.DurationHours, formatSun(pkg.PriceSun)))
	}
	lines = append(lines,
		"",
		"━━━━━━━━━━━━",
		fmt.Sprintf("⏳ 支付有效期：%d 分钟", int(ttl.Minutes())),
		"💳 你只需要支付套餐售价，到账后自动派发能量。",
		"♻️ 到期系统自动回收，请在套餐时长内使用。",
		"",
		"👇 点击下方套餐按钮开始下单。",
	)
	return strings.Join(lines, "\n")
}

func packageDetailText(pkg EnergyPackage) string {
	return strings.Join([]string{
		"✅ 套餐已锁定",
		"",
		fmt.Sprintf("📦 套餐：%s", pkg.PackageName),
		fmt.Sprintf("⚡ 能量：%d", pkg.EnergyAmount),
		fmt.Sprintf("⏱ 时长：%d 小时", pkg.DurationHours),
		fmt.Sprintf("💰 应付：%s TRX", formatSun(pkg.PriceSun)),
		"",
		"📥 下一步：直接发送接收能量的 TRON 地址。",
		"地址必须以 T 开头，建议复制钱包收款地址。",
	}, "\n")
}

func addressManagementText(addresses []UserAddress) string {
	lines := []string{
		"📍 地址管理",
		"",
		fmt.Sprintf("已绑定 %d/%d 个地址", len(addresses), maxUserAddresses),
	}
	if len(addresses) == 0 {
		lines = append(lines,
			"",
			"你还没有绑定接收地址。",
			"下单前必须先添加自己的 TRON 地址。",
		)
	} else {
		lines = append(lines, "", "📒 我的地址")
		for index, item := range addresses {
			prefix := "📍"
			if item.IsDefault {
				prefix = "⭐"
			}
			lines = append(lines, fmt.Sprintf("%d. %s %s", index+1, prefix, item.Label))
			lines = append(lines, fmt.Sprintf("   %s", item.Address))
		}
	}
	lines = append(lines,
		"",
		"新增、修改、删除都在下方按钮操作。",
	)
	return strings.Join(lines, "\n")
}

func addressSelectionText(pkg EnergyPackage, addresses []UserAddress) string {
	lines := []string{
		"📥 选择接收地址",
		"",
		fmt.Sprintf("📦 套餐：%s", pkg.PackageName),
		fmt.Sprintf("⚡ 能量：%d", pkg.EnergyAmount),
		fmt.Sprintf("⏱ 时长：%d 小时", pkg.DurationHours),
		fmt.Sprintf("💰 应付：%s TRX", formatSun(pkg.PriceSun)),
		"",
	}
	if len(addresses) == 0 {
		lines = append(lines,
			"请先在地址管理里新增接收地址，绑定后才能继续下单。",
			fmt.Sprintf("每个用户最多可绑定 %d 个地址。", maxUserAddresses),
		)
	} else {
		lines = append(lines,
			"请选择本次接收能量的地址：",
			"",
		)
		for index, item := range addresses {
			prefix := "📍"
			if item.IsDefault {
				prefix = "⭐"
			}
			lines = append(lines, fmt.Sprintf("%d. %s %s  %s", index+1, prefix, item.Label, shortAddress(item.Address)))
		}
	}
	return strings.Join(lines, "\n")
}

func addressManagementKeyboard(addresses []UserAddress) *inlineKeyboardMarkup {
	rows := [][]inlineKeyboardButton{
		{{Text: "➕ 添加地址", CallbackData: "addr:add"}},
	}
	for _, item := range addresses {
		defaultText := "设默认"
		if item.IsDefault {
			defaultText = "⭐ 默认"
		}
		rows = append(rows, []inlineKeyboardButton{
			{Text: defaultText, CallbackData: fmt.Sprintf("addr:default:%d", item.ID)},
			{Text: fmt.Sprintf("✏️ %s", item.Label), CallbackData: fmt.Sprintf("addr:edit:%d", item.ID)},
			{Text: "🗑 删除", CallbackData: fmt.Sprintf("addr:del:%d", item.ID)},
		})
	}
	return &inlineKeyboardMarkup{InlineKeyboard: rows}
}

func walletQueryMenuText(addresses []UserAddress) string {
	lines := []string{
		"🔎 钱包查询",
		"",
		"可以查看 TRX 余额、能量、带宽、质押和租入能量等链上数据。",
	}
	if len(addresses) == 0 {
		lines = append(lines,
			"",
			"你还没有绑定地址。",
			"请先到「📍 地址管理」添加地址，或直接发送：",
			"查询 Txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
		)
		return strings.Join(lines, "\n")
	}

	lines = append(lines, "", "请选择要查询的钱包地址：")
	for index, item := range addresses {
		prefix := "📍"
		if item.IsDefault {
			prefix = "⭐"
		}
		lines = append(lines, fmt.Sprintf("%d. %s %s  %s", index+1, prefix, item.Label, shortAddress(item.Address)))
	}
	lines = append(lines, "", "也可以直接发送「查询 + TRON 地址」查询任意地址。")
	return strings.Join(lines, "\n")
}

func walletQueryKeyboard(addresses []UserAddress) *inlineKeyboardMarkup {
	rows := [][]inlineKeyboardButton{}
	for _, item := range addresses {
		rows = append(rows, []inlineKeyboardButton{{
			Text:         fmt.Sprintf("🔎 %s %s", item.Label, shortAddress(item.Address)),
			CallbackData: fmt.Sprintf("wallet:addr:%d", item.ID),
		}})
	}
	rows = append(rows, []inlineKeyboardButton{{Text: "📍 地址管理", CallbackData: "addr:menu"}})
	return &inlineKeyboardMarkup{InlineKeyboard: rows}
}

func walletResultKeyboard(addressID int) *inlineKeyboardMarkup {
	rows := [][]inlineKeyboardButton{}
	if addressID > 0 {
		rows = append(rows, []inlineKeyboardButton{{Text: "🔄 刷新钱包数据", CallbackData: fmt.Sprintf("wallet:addr:%d", addressID)}})
	}
	rows = append(rows, []inlineKeyboardButton{{Text: "🔎 查询其他地址", CallbackData: "wallet:menu"}})
	return &inlineKeyboardMarkup{InlineKeyboard: rows}
}

func addressSelectionKeyboard(packageID int, addresses []UserAddress, _ *replyKeyboardMarkup) *inlineKeyboardMarkup {
	rows := [][]inlineKeyboardButton{}
	for _, item := range addresses {
		rows = append(rows, []inlineKeyboardButton{{
			Text:         fmt.Sprintf("⚡ 用 %s %s 下单", item.Label, shortAddress(item.Address)),
			CallbackData: fmt.Sprintf("order:%d:%d", packageID, item.ID),
		}})
	}
	rows = append(rows, []inlineKeyboardButton{{Text: "➕ 添加地址", CallbackData: "addr:add"}})
	rows = append(rows, []inlineKeyboardButton{{Text: "📍 地址管理", CallbackData: "addr:menu"}})
	return &inlineKeyboardMarkup{InlineKeyboard: rows}
}

func walletSnapshotText(snapshot WalletSnapshot, label string) string {
	label = strings.TrimSpace(label)
	if label == "" {
		label = "临时查询"
	}
	energyAvailable := remaining(snapshot.EnergyLimit, snapshot.EnergyUsed)
	bandwidthUsed := snapshot.FreeNetUsed + snapshot.NetUsed
	bandwidthLimit := snapshot.FreeNetLimit + snapshot.NetLimit
	bandwidthAvailable := remaining(bandwidthLimit, bandwidthUsed)

	status := "未激活"
	if snapshot.Activated {
		status = "已激活"
	}

	lines := []string{
		"🔎 钱包查询",
		"━━━━━━━━━━━━",
		fmt.Sprintf("🏷 地址标签：%s", label),
		fmt.Sprintf("📮 地址：%s", shortAddress(snapshot.Address)),
		snapshot.Address,
		"",
		"💼 资产",
		fmt.Sprintf("💰 TRX 可用：%s TRX", formatSunInt(snapshot.BalanceSun)),
		fmt.Sprintf("🔒 TRX 质押：%s TRX", formatSunInt(snapshot.StakedSun)),
		fmt.Sprintf("🧊 租入能量质押：%s TRX", formatSunInt(snapshot.AcquiredEnergyDelegatedSun)),
		"",
		"⚡ 资源",
		fmt.Sprintf("⚡ 能量：%d / %d", energyAvailable, snapshot.EnergyLimit),
		fmt.Sprintf("   已用能量：%d", snapshot.EnergyUsed),
		fmt.Sprintf("📶 带宽：%d / %d", bandwidthAvailable, bandwidthLimit),
		fmt.Sprintf("   已用带宽：%d", bandwidthUsed),
		"",
		"🗳 权限与状态",
		fmt.Sprintf("🗳 投票数：%d", snapshot.VotesUsed),
		fmt.Sprintf("✅ 账户状态：%s", status),
	}
	if snapshot.LatestOperationTime > 0 {
		lines = append(lines, fmt.Sprintf("🕒 最后活动：%s", formatUnixMillis(snapshot.LatestOperationTime)))
	}
	return strings.Join(lines, "\n")
}

func paymentOrderText(detail createdOrderDetail) string {
	return strings.Join([]string{
		"┌ 马儿能量",
		"🔥 1小时特价能量",
		"✅ 支付订单已生成",
		"━━━━━━━━━━━━",
		fmt.Sprintf("🧾 订单号：%s", detail.OrderNo),
		fmt.Sprintf("📦 套餐：%s", detail.PackageName),
		fmt.Sprintf("⚡ 能量：%d", detail.EnergyAmount),
		fmt.Sprintf("⏱ 时长：%d 小时", detail.DurationHours),
		fmt.Sprintf("💰 应付金额：%s TRX", formatSun(detail.PriceSun)),
		"",
		"📮 收款地址（长按复制）",
		detail.ReceiveAddress,
		"",
		"📥 能量接收地址",
		detail.ReceiverAddress,
		"",
		fmt.Sprintf("⏳ 请在%d分钟内付款，超时订单自动取消。", int(detail.TTL.Minutes())),
		"⚡ 到账后系统会自动派发能量。",
	}, "\n")
}

func redactTelegramToken(message string, token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return message
	}
	return strings.ReplaceAll(message, "/bot"+token+"/", "/bot[redacted]/")
}

func parseCallbackID(data string, prefix string) (int, error) {
	raw := strings.TrimPrefix(data, prefix)
	if raw == data || strings.TrimSpace(raw) == "" {
		return 0, fmt.Errorf("invalid callback data")
	}
	return strconv.Atoi(raw)
}

func parseOrderCallback(data string) (int, int, error) {
	parts := strings.Split(data, ":")
	if len(parts) != 3 || parts[0] != "order" {
		return 0, 0, fmt.Errorf("invalid order callback")
	}
	packageID, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, err
	}
	addressID, err := strconv.Atoi(parts[2])
	if err != nil {
		return 0, 0, err
	}
	return packageID, addressID, nil
}

func parseWalletQueryAddress(text string) (string, bool) {
	text = strings.TrimSpace(text)
	if looksLikeTronAddress(text) {
		return text, true
	}

	for _, prefix := range []string{"钱包查询", "查钱包", "查询", "钱包"} {
		if !strings.HasPrefix(text, prefix) {
			continue
		}
		address := strings.TrimSpace(strings.TrimPrefix(text, prefix))
		address = strings.TrimLeft(address, "：: ")
		if looksLikeTronAddress(address) {
			return address, true
		}
	}
	return "", false
}

func shortAddress(address string) string {
	address = strings.TrimSpace(address)
	runes := []rune(address)
	if len(runes) <= 14 {
		return address
	}
	return fmt.Sprintf("%s...%s", string(runes[:6]), string(runes[len(runes)-6:]))
}

func looksLikeTronAddress(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasPrefix(value, "T") && len(value) >= 30 && len(value) <= 40
}

func formatSun(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "0"
	}
	sun, ok := strconv.ParseInt(value, 10, 64)
	if ok != nil {
		return value
	}
	whole := sun / 1_000_000
	fraction := sun % 1_000_000
	if fraction == 0 {
		return strconv.FormatInt(whole, 10)
	}
	return strings.TrimRight(fmt.Sprintf("%d.%06d", whole, fraction), "0")
}

func formatSunInt(sun int64) string {
	return formatSun(strconv.FormatInt(sun, 10))
}

func currentPackagePriceSun(pkg EnergyPackage, now time.Time) string {
	hour := now.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Hour()
	if hour >= 20 || hour < 10 {
		if strings.TrimSpace(pkg.BusyPriceSun) != "" {
			return strings.TrimSpace(pkg.BusyPriceSun)
		}
	}
	if strings.TrimSpace(pkg.IdlePriceSun) != "" {
		return strings.TrimSpace(pkg.IdlePriceSun)
	}
	return strings.TrimSpace(pkg.PriceSun)
}

func formatUnixMillis(value int64) string {
	return time.UnixMilli(value).Local().Format("2006-01-02 15:04:05")
}

func remaining(limit int64, used int64) int64 {
	value := limit - used
	if value < 0 {
		return 0
	}
	return value
}

func newOrderNo(now time.Time) string {
	buf := make([]byte, 3)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("ER%s", now.Format("20060102150405"))
	}
	return fmt.Sprintf("ER%s%s", now.Format("20060102150405"), strings.ToUpper(hex.EncodeToString(buf)))
}

func sleepOrDone(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
