// Package main 的 apply-config 子命令实现。
//
// 流程：
//  1. 读 JSON 文件 → 反序列化为 applyConfigInput
//  2. storage.Open（若文件不存在自动创建）
//  3. UPDATE energy_platform_config（单例 id=1）20+ 列
//  4. UPDATE bot_config（单例 id=1）token/welcome/menu/message
//  5. 关闭 db，返 nil
//
// MVP 阶段 token 走明文：bot_config.encrypted_token 存 UTF-8 bytes，
// encrypted_token_nonce 留 NULL。Bot 启动时通过 config.LoadFromDatabase 识别
// nonce IS NULL 即视为明文读出。T11.6 加密时把这步换成 AES-GCM 加密 + nonce。
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/anomalyco/energybot-bot/internal/storage"
)

// applyConfigInput 是 apply-config 子命令期待的 JSON 顶层结构。
//
// 与 nest-api `agent.applyConfig` notification 的 params 完全对齐——nest-api
// 那边用 typescript interface AgentApplyConfigParams，键名 camelCase。这里也
// 用 camelCase 匹配 jsonrpc 默认风格。
//
// MVP 字段集（不含 bitcart——nest-api 还没把 bitcart 配置放进 agent push 流；
// 后续 T12 会补）。已 push 但 bot 现在不依赖的字段先收下不用，预留向前兼容。
type applyConfigInput struct {
	// DatabaseURL 通常和 agent 启动时的 DATABASE_URL env 一致——但显式带上
	// 让 apply-config 子命令可独立测试，不依赖 env。
	DatabaseURL string `json:"databaseUrl"`

	Platform platformConfigInput `json:"platform"`
	Bot      botConfigInput      `json:"bot"`
}

type platformConfigInput struct {
	TronAPIBaseURL          string `json:"tronApiBaseUrl"`
	TronAPIKey              string `json:"tronApiKey"`
	PlatformReceiveAddress  string `json:"platformReceiveAddress"`
	JustLendContractAddress string `json:"justlendContractAddress"`
	JustLendPayerPrivateKey string `json:"justlendPayerPrivateKey"`
	EnergyProvider          string `json:"energyProvider"`
	CatFeeEnvironment       string `json:"catfeeEnvironment"`
	CatFeeProdAPIBaseURL    string `json:"catfeeProdApiBaseUrl"`
	CatFeeProdAPIKey        string `json:"catfeeProdApiKey"`
	CatFeeProdAPISecret     string `json:"catfeeProdApiSecret"`
	CatFeeNileAPIBaseURL    string `json:"catfeeNileApiBaseUrl"`
	CatFeeNileAPIKey        string `json:"catfeeNileApiKey"`
	CatFeeNileAPISecret     string `json:"catfeeNileApiSecret"`
	CatFeeAutoActivate      bool   `json:"catfeeAutoActivate"`
	OrderPaymentTTLMinutes  int    `json:"orderPaymentTtlMinutes"`
	TelegramPollingInterval int    `json:"telegramPollingIntervalSeconds"`
	WorkerIntervalSeconds   int    `json:"workerIntervalSeconds"`
	MinTRXReserveSun        string `json:"minTrxReserveSun"`
}

type botConfigInput struct {
	Token         string `json:"token"`
	Username      string `json:"username"`
	WelcomeText   string `json:"welcomeText"`
	MenuConfig    string `json:"menuConfig"`    // 整个 JSON 字符串原样存
	MessageConfig string `json:"messageConfig"` // 整个 JSON 字符串原样存
}

// applyConfigFromFile 读 JSON 文件并 apply 到 SQLite。
//
// 失败原因都包成 fmt.Errorf 向上抛——main 的 log.Fatalf 会把错误信息写到 stderr
// 并 exit 1，agent dispatcher 据此决定 jsonrpc 响应里要不要带 error。
func applyConfigFromFile(jsonPath string) error {
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return fmt.Errorf("read json file: %w", err)
	}

	var input applyConfigInput
	if err := json.Unmarshal(data, &input); err != nil {
		return fmt.Errorf("unmarshal json: %w", err)
	}
	if strings.TrimSpace(input.DatabaseURL) == "" {
		return errors.New("databaseUrl is required")
	}

	db, err := storage.Open(input.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open sqlite: %w", err)
	}
	defer func() { _ = db.Close() }()

	if err := upsertPlatformConfig(db, input.Platform); err != nil {
		return fmt.Errorf("upsert platform_config: %w", err)
	}
	if err := upsertBotConfig(db, input.Bot); err != nil {
		return fmt.Errorf("upsert bot_config: %w", err)
	}
	return nil
}

// upsertPlatformConfig 把 platform 字段 UPDATE 到 energy_platform_config（单例 id=1）。
//
// 表行已由 0001 migration 的 INSERT OR IGNORE 保证存在，所以这里只 UPDATE 不 INSERT。
//
// platform_receive_address 列由 0002 migration 加。
//
// 不在 SQL 里用 COALESCE——如果 input.PlatformReceiveAddress 是空字符串，那就显式
// 把列写成空字符串（业务方意图：清掉历史值）。
func upsertPlatformConfig(db *sql.DB, p platformConfigInput) error {
	const query = `
UPDATE energy_platform_config SET
  tron_api_base_url = ?,
  tron_api_key = ?,
  platform_receive_address = ?,
  justlend_contract_address = ?,
  justlend_payer_private_key = ?,
  energy_provider = ?,
  catfee_environment = ?,
  catfee_prod_api_base_url = ?,
  catfee_prod_api_key = ?,
  catfee_prod_api_secret = ?,
  catfee_nile_api_base_url = ?,
  catfee_nile_api_key = ?,
  catfee_nile_api_secret = ?,
  catfee_auto_activate = ?,
  order_payment_ttl_minutes = ?,
  telegram_polling_interval_seconds = ?,
  worker_interval_seconds = ?,
  min_trx_reserve_sun = ?,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 1`

	_, err := db.Exec(query,
		coalesceDefault(p.TronAPIBaseURL, "https://api.trongrid.io"),
		p.TronAPIKey,
		p.PlatformReceiveAddress,
		p.JustLendContractAddress,
		p.JustLendPayerPrivateKey,
		coalesceDefault(p.EnergyProvider, "justlend"),
		coalesceDefault(p.CatFeeEnvironment, "nile"),
		coalesceDefault(p.CatFeeProdAPIBaseURL, "https://api.catfee.io"),
		p.CatFeeProdAPIKey,
		p.CatFeeProdAPISecret,
		coalesceDefault(p.CatFeeNileAPIBaseURL, "https://nile.catfee.io"),
		p.CatFeeNileAPIKey,
		p.CatFeeNileAPISecret,
		p.CatFeeAutoActivate,
		coalesceInt(p.OrderPaymentTTLMinutes, 10),
		coalesceInt(p.TelegramPollingInterval, 2),
		coalesceInt(p.WorkerIntervalSeconds, 60),
		coalesceDefault(p.MinTRXReserveSun, "0"),
	)
	return err
}

// upsertBotConfig 写 token/welcome/menu/message 到 bot_config 单例。
//
// MVP 明文路径：encrypted_token 存 UTF-8 bytes，encrypted_token_nonce = NULL。
// Bot 启动时识别 nonce IS NULL 视为明文。
//
// config_version 自增——welcome/menu 在线更新场景需要 bot polling 时检测变化重启。
// MVP 不依赖此字段做热更，但保留行为一致以便 T13 接入。
func upsertBotConfig(db *sql.DB, b botConfigInput) error {
	const query = `
UPDATE bot_config SET
  config_version = config_version + 1,
  encrypted_token = ?,
  encrypted_token_nonce = NULL,
  telegram_bot_username = ?,
  welcome_text = ?,
  menu_config = ?,
  message_config = ?,
  applied_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 1`

	var tokenBytes []byte
	if b.Token != "" {
		tokenBytes = []byte(b.Token)
	}

	_, err := db.Exec(query,
		tokenBytes,
		b.Username,
		b.WelcomeText,
		b.MenuConfig,
		b.MessageConfig,
	)
	return err
}

func coalesceDefault(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

func coalesceInt(v, fallback int) int {
	if v <= 0 {
		return fallback
	}
	return v
}

// writeFile 是 apply_config_test 用的小工具，单独 export 在这避免暴露给主流程。
func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o600)
}
