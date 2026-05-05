package config

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	defaultOrderPaymentTTL         = 10 * time.Minute
	defaultEnergyRentalTTL         = time.Hour
	defaultTelegramPollingInterval = 2 * time.Second
	defaultWorkerInterval          = time.Minute
	defaultEnergyProvider          = "justlend"
	defaultCatFeeEnvironment       = "nile"
	defaultCatFeeProdAPIBaseURL    = "https://api.catfee.io"
	defaultCatFeeNileAPIBaseURL    = "https://nile.catfee.io"
)

var requiredKeys = []string{
	"DATABASE_URL",
	"TELEGRAM_BOT_TOKEN",
	"TRON_API_BASE_URL",
	"TRON_API_KEY",
	"PLATFORM_RECEIVE_ADDRESS",
	"JUSTLEND_CONTRACT_ADDRESS",
	"JUSTLEND_PAYER_PRIVATE_KEY",
}

type EnvMap map[string]string

type Config struct {
	DatabaseURL             string
	BotStatus               string
	TelegramBotToken        string
	TronAPIBaseURL          string
	TronAPIKey              string
	PlatformReceiveAddress  string
	JustLendContractAddress string
	JustLendPayerPrivateKey string
	OrderPaymentTTL         time.Duration
	EnergyRentalTTL         time.Duration
	TelegramPollingInterval time.Duration
	WorkerInterval          time.Duration
	MinTRXReserveSun        string
	EnergyProvider          string
	CatFeeEnvironment       string
	CatFeeProdAPIBaseURL    string
	CatFeeProdAPIKey        string
	CatFeeProdAPISecret     string
	CatFeeNileAPIBaseURL    string
	CatFeeNileAPIKey        string
	CatFeeNileAPISecret     string
	CatFeeAutoActivate      bool
}

type RowScanner interface {
	Scan(dest ...any) error
}

type QueryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) RowScanner
}

func LoadFromEnv() (Config, error) {
	return Load(FromOSEnviron())
}

func FromOSEnviron() EnvMap {
	env := EnvMap{}
	for _, item := range os.Environ() {
		key, value, ok := strings.Cut(item, "=")
		if ok {
			env[key] = value
		}
	}
	return env
}

func Load(env EnvMap) (Config, error) {
	if env == nil {
		env = EnvMap{}
	}

	var missing []string
	for _, key := range requiredKeys {
		if strings.TrimSpace(env[key]) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required config: %s", strings.Join(missing, ", "))
	}

	orderPaymentTTL, err := durationOrDefault(env, "ORDER_PAYMENT_TTL", defaultOrderPaymentTTL)
	if err != nil {
		return Config{}, err
	}
	energyRentalTTL, err := durationOrDefault(env, "ENERGY_RENTAL_TTL", defaultEnergyRentalTTL)
	if err != nil {
		return Config{}, err
	}
	pollingInterval, err := durationOrDefault(env, "TELEGRAM_POLLING_INTERVAL", defaultTelegramPollingInterval)
	if err != nil {
		return Config{}, err
	}
	workerInterval, err := durationOrDefault(env, "WORKER_INTERVAL", defaultWorkerInterval)
	if err != nil {
		return Config{}, err
	}

	return Config{
		DatabaseURL:             normalizeDatabaseURL(env["DATABASE_URL"]),
		BotStatus:               envOrDefault(env, "BOT_STATUS", "enabled"),
		TelegramBotToken:        strings.TrimSpace(env["TELEGRAM_BOT_TOKEN"]),
		TronAPIBaseURL:          strings.TrimSpace(env["TRON_API_BASE_URL"]),
		TronAPIKey:              strings.TrimSpace(env["TRON_API_KEY"]),
		PlatformReceiveAddress:  strings.TrimSpace(env["PLATFORM_RECEIVE_ADDRESS"]),
		JustLendContractAddress: strings.TrimSpace(env["JUSTLEND_CONTRACT_ADDRESS"]),
		JustLendPayerPrivateKey: strings.TrimSpace(env["JUSTLEND_PAYER_PRIVATE_KEY"]),
		OrderPaymentTTL:         orderPaymentTTL,
		EnergyRentalTTL:         energyRentalTTL,
		TelegramPollingInterval: pollingInterval,
		WorkerInterval:          workerInterval,
		MinTRXReserveSun:        envOrDefault(env, "MIN_TRX_RESERVE_SUN", "0"),
		EnergyProvider:          envOrDefault(env, "ENERGY_PROVIDER", defaultEnergyProvider),
		CatFeeEnvironment:       envOrDefault(env, "CATFEE_ENVIRONMENT", defaultCatFeeEnvironment),
		CatFeeProdAPIBaseURL:    envOrDefault(env, "CATFEE_PROD_API_BASE_URL", defaultCatFeeProdAPIBaseURL),
		CatFeeProdAPIKey:        strings.TrimSpace(env["CATFEE_PROD_API_KEY"]),
		CatFeeProdAPISecret:     strings.TrimSpace(env["CATFEE_PROD_API_SECRET"]),
		CatFeeNileAPIBaseURL:    envOrDefault(env, "CATFEE_NILE_API_BASE_URL", defaultCatFeeNileAPIBaseURL),
		CatFeeNileAPIKey:        strings.TrimSpace(env["CATFEE_NILE_API_KEY"]),
		CatFeeNileAPISecret:     strings.TrimSpace(env["CATFEE_NILE_API_SECRET"]),
		CatFeeAutoActivate:      boolOrDefault(env, "CATFEE_AUTO_ACTIVATE", true),
	}, nil
}

// LoadFromDatabase 从 SQLite 读 energy_platform_config（单例 id=1）+ bot_config（单例 id=1），
// 组装成 Config。
//
// B3 schema 改造说明（T11.3c）：
//   - 旧 B1 主站 schema 把 bot_status / telegram_bot_token / platform_receive_address
//     都放在 energy_platform_config 单表。B3 单租户拆开了：
//     - platform_receive_address 仍在 platform_config（由 0002 migration 补上）
//     - telegram_bot_token 转移到 bot_config.encrypted_token（BLOB，加密 by AES-GCM）
//     - bot_status 不再持久化——由 agent supervisor 内存管理
//
// MVP token 解密策略：
//   - encrypted_token_nonce IS NULL → 视为明文 BLOB，直接 string(bytes)
//   - encrypted_token_nonce 非 NULL → AES-GCM 解密（T11.6 实现，当前版本返 err）
//
// BotStatus 字段：LoadFromDatabase 总是返 "enabled"——既然 agent 决定了跑 bot
// 进程才会调到这里。validateRuntimeConfig 的 BotStatus 检查保留兼容旧测试。
func LoadFromDatabase(ctx context.Context, env EnvMap, store QueryRower) (Config, error) {
	if env == nil {
		env = EnvMap{}
	}
	if store == nil {
		return Config{}, errors.New("config store is required")
	}

	databaseURL := normalizeDatabaseURL(env["DATABASE_URL"])
	if databaseURL == "" {
		return Config{}, errors.New("missing required config: DATABASE_URL")
	}

	const query = `
SELECT
  COALESCE(p.tron_api_base_url, 'https://api.trongrid.io'),
  COALESCE(p.tron_api_key, ''),
  COALESCE(p.platform_receive_address, ''),
  COALESCE(p.justlend_contract_address, ''),
  COALESCE(p.justlend_payer_private_key, ''),
  COALESCE(p.order_payment_ttl_minutes, 10),
  COALESCE(p.telegram_polling_interval_seconds, 2),
  COALESCE(p.worker_interval_seconds, 60),
  COALESCE(p.min_trx_reserve_sun, '0'),
  COALESCE(p.energy_provider, 'justlend'),
  COALESCE(p.catfee_environment, 'nile'),
  COALESCE(p.catfee_prod_api_base_url, 'https://api.catfee.io'),
  COALESCE(p.catfee_prod_api_key, ''),
  COALESCE(p.catfee_prod_api_secret, ''),
  COALESCE(p.catfee_nile_api_base_url, 'https://nile.catfee.io'),
  COALESCE(p.catfee_nile_api_key, ''),
  COALESCE(p.catfee_nile_api_secret, ''),
  COALESCE(p.catfee_auto_activate, 1),
  b.encrypted_token,
  b.encrypted_token_nonce
FROM energy_platform_config p
LEFT JOIN bot_config b ON b.id = 1
WHERE p.id = 1`

	var (
		cfg                            Config
		orderPaymentTTLMinutes         int32
		telegramPollingIntervalSecond  int32
		workerIntervalSeconds          int32
		encryptedToken                 []byte
		encryptedTokenNonce            []byte
	)
	err := store.QueryRow(ctx, query).Scan(
		&cfg.TronAPIBaseURL,
		&cfg.TronAPIKey,
		&cfg.PlatformReceiveAddress,
		&cfg.JustLendContractAddress,
		&cfg.JustLendPayerPrivateKey,
		&orderPaymentTTLMinutes,
		&telegramPollingIntervalSecond,
		&workerIntervalSeconds,
		&cfg.MinTRXReserveSun,
		&cfg.EnergyProvider,
		&cfg.CatFeeEnvironment,
		&cfg.CatFeeProdAPIBaseURL,
		&cfg.CatFeeProdAPIKey,
		&cfg.CatFeeProdAPISecret,
		&cfg.CatFeeNileAPIBaseURL,
		&cfg.CatFeeNileAPIKey,
		&cfg.CatFeeNileAPISecret,
		&cfg.CatFeeAutoActivate,
		&encryptedToken,
		&encryptedTokenNonce,
	)
	if err != nil {
		return Config{}, fmt.Errorf("load platform config from database: %w", err)
	}

	// 解析 token：MVP 仅支持明文（nonce IS NULL）。
	token, err := decodeBotToken(encryptedToken, encryptedTokenNonce)
	if err != nil {
		return Config{}, err
	}
	cfg.TelegramBotToken = token

	// BotStatus：能跑到 LoadFromDatabase 说明 agent 决定要跑 bot——给 enabled。
	// validateRuntimeConfig 的兼容检查需要 enabled+token 两件都齐。
	if strings.TrimSpace(token) == "" {
		cfg.BotStatus = "disabled"
	} else {
		cfg.BotStatus = "enabled"
	}

	cfg.DatabaseURL = databaseURL
	cfg.TronAPIBaseURL = strings.TrimSpace(cfg.TronAPIBaseURL)
	cfg.TronAPIKey = strings.TrimSpace(cfg.TronAPIKey)
	cfg.PlatformReceiveAddress = strings.TrimSpace(cfg.PlatformReceiveAddress)
	cfg.JustLendContractAddress = strings.TrimSpace(cfg.JustLendContractAddress)
	cfg.JustLendPayerPrivateKey = strings.TrimSpace(cfg.JustLendPayerPrivateKey)
	cfg.MinTRXReserveSun = strings.TrimSpace(cfg.MinTRXReserveSun)
	cfg.EnergyProvider = normalizeProvider(cfg.EnergyProvider)
	cfg.CatFeeEnvironment = normalizeCatFeeEnvironment(cfg.CatFeeEnvironment)
	cfg.CatFeeProdAPIBaseURL = strings.TrimRight(strings.TrimSpace(envOrDefault(EnvMap{"v": cfg.CatFeeProdAPIBaseURL}, "v", defaultCatFeeProdAPIBaseURL)), "/")
	cfg.CatFeeProdAPIKey = strings.TrimSpace(cfg.CatFeeProdAPIKey)
	cfg.CatFeeProdAPISecret = strings.TrimSpace(cfg.CatFeeProdAPISecret)
	cfg.CatFeeNileAPIBaseURL = strings.TrimRight(strings.TrimSpace(envOrDefault(EnvMap{"v": cfg.CatFeeNileAPIBaseURL}, "v", defaultCatFeeNileAPIBaseURL)), "/")
	cfg.CatFeeNileAPIKey = strings.TrimSpace(cfg.CatFeeNileAPIKey)
	cfg.CatFeeNileAPISecret = strings.TrimSpace(cfg.CatFeeNileAPISecret)

	if err := validateRuntimeConfig(cfg); err != nil {
		return Config{}, err
	}

	var durationErr error
	cfg.OrderPaymentTTL, durationErr = minutesToDuration("order_payment_ttl_minutes", orderPaymentTTLMinutes)
	if durationErr != nil {
		return Config{}, durationErr
	}
	cfg.EnergyRentalTTL = defaultEnergyRentalTTL
	cfg.TelegramPollingInterval, durationErr = secondsToDuration("telegram_polling_interval_seconds", telegramPollingIntervalSecond)
	if durationErr != nil {
		return Config{}, durationErr
	}
	cfg.WorkerInterval, durationErr = secondsToDuration("worker_interval_seconds", workerIntervalSeconds)
	if durationErr != nil {
		return Config{}, durationErr
	}

	return cfg, nil
}

func normalizeDatabaseURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" {
		return value
	}

	query := parsed.Query()
	schema := strings.TrimSpace(query.Get("schema"))
	if schema == "" {
		return value
	}

	query.Del("schema")
	if strings.TrimSpace(query.Get("search_path")) == "" {
		query.Set("search_path", schema)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func validateRuntimeConfig(cfg Config) error {
	var missing []string
	for key, value := range map[string]string{
		"TRON_API_BASE_URL":        cfg.TronAPIBaseURL,
		"TRON_API_KEY":             cfg.TronAPIKey,
		"PLATFORM_RECEIVE_ADDRESS": cfg.PlatformReceiveAddress,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required platform config: %s", strings.Join(missing, ", "))
	}
	if cfg.BotStatus != "enabled" && cfg.BotStatus != "disabled" {
		return fmt.Errorf("invalid bot_status: %s", cfg.BotStatus)
	}
	if cfg.BotStatus == "enabled" && strings.TrimSpace(cfg.TelegramBotToken) == "" {
		missing = append(missing, "TELEGRAM_BOT_TOKEN")
	}
	switch normalizeProvider(cfg.EnergyProvider) {
	case "justlend":
		for key, value := range map[string]string{
			"JUSTLEND_CONTRACT_ADDRESS":  cfg.JustLendContractAddress,
			"JUSTLEND_PAYER_PRIVATE_KEY": cfg.JustLendPayerPrivateKey,
		} {
			if strings.TrimSpace(value) == "" {
				missing = append(missing, key)
			}
		}
	case "catfee":
		for key, value := range map[string]string{
			"CATFEE_API_BASE_URL": cfg.CatFeeAPIBaseURL(),
			"CATFEE_API_KEY":      cfg.CatFeeAPIKey(),
			"CATFEE_API_SECRET":   cfg.CatFeeAPISecret(),
		} {
			if strings.TrimSpace(value) == "" {
				missing = append(missing, key)
			}
		}
	default:
		return fmt.Errorf("invalid energy_provider: %s", cfg.EnergyProvider)
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required platform config: %s", strings.Join(missing, ", "))
	}
	if cfg.MinTRXReserveSun == "" {
		return errors.New("invalid min_trx_reserve_sun: must be set")
	}
	return nil
}

func (c Config) UsesJustLend() bool {
	return normalizeProvider(c.EnergyProvider) == "justlend"
}

func (c Config) UsesCatFee() bool {
	return normalizeProvider(c.EnergyProvider) == "catfee"
}

func (c Config) CatFeeAPIBaseURL() string {
	return c.CatFeeAPIBaseURLFor(c.CatFeeEnvironment)
}

func (c Config) CatFeeAPIBaseURLFor(environment string) string {
	if c.catFeeEnvironmentFor(environment) == "prod" {
		return strings.TrimRight(strings.TrimSpace(c.CatFeeProdAPIBaseURL), "/")
	}
	return strings.TrimRight(strings.TrimSpace(c.CatFeeNileAPIBaseURL), "/")
}

func (c Config) CatFeeAPIKey() string {
	return c.CatFeeAPIKeyFor(c.CatFeeEnvironment)
}

func (c Config) CatFeeAPIKeyFor(environment string) string {
	if c.catFeeEnvironmentFor(environment) == "prod" {
		return strings.TrimSpace(c.CatFeeProdAPIKey)
	}
	return strings.TrimSpace(c.CatFeeNileAPIKey)
}

func (c Config) CatFeeAPISecret() string {
	return c.CatFeeAPISecretFor(c.CatFeeEnvironment)
}

func (c Config) CatFeeAPISecretFor(environment string) string {
	if c.catFeeEnvironmentFor(environment) == "prod" {
		return strings.TrimSpace(c.CatFeeProdAPISecret)
	}
	return strings.TrimSpace(c.CatFeeNileAPISecret)
}

func (c Config) CatFeeEnvironmentFor(environment string) string {
	return c.catFeeEnvironmentFor(environment)
}

func (c Config) catFeeEnvironmentFor(environment string) string {
	if strings.TrimSpace(environment) == "" {
		return normalizeCatFeeEnvironment(c.CatFeeEnvironment)
	}
	return normalizeCatFeeEnvironment(environment)
}

func normalizeProvider(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return defaultEnergyProvider
	}
	return value
}

func normalizeCatFeeEnvironment(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "production" || value == "mainnet" {
		return "prod"
	}
	if value == "prod" {
		return "prod"
	}
	return defaultCatFeeEnvironment
}

func durationOrDefault(env EnvMap, key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(env[key])
	if raw == "" {
		return fallback, nil
	}

	value, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid duration for %s: %w", key, err)
	}
	if value <= 0 {
		return 0, fmt.Errorf("invalid duration for %s: %w", key, errors.New("must be positive"))
	}
	return value, nil
}

func minutesToDuration(name string, value int32) (time.Duration, error) {
	if value <= 0 {
		return 0, fmt.Errorf("invalid %s: must be positive", name)
	}
	return time.Duration(value) * time.Minute, nil
}

func secondsToDuration(name string, value int32) (time.Duration, error) {
	if value <= 0 {
		return 0, fmt.Errorf("invalid %s: must be positive", name)
	}
	return time.Duration(value) * time.Second, nil
}

func envOrDefault(env EnvMap, key string, fallback string) string {
	value := strings.TrimSpace(env[key])
	if value == "" {
		return fallback
	}
	return value
}

func boolOrDefault(env EnvMap, key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(env[key]))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes" || value == "enabled"
}

// decodeBotToken 解码 bot_config.encrypted_token / encrypted_token_nonce 两列。
//
// MVP 阶段（T11.6 之前）：
//   - 两列都为 NULL/空 → 返空 token（bot 启动会被 validateRuntimeConfig 拦下，
//     由 supervisor 报错给主站；agent 应该在 applyConfig 之后才 start bot）
//   - encryptedToken 非空、nonce IS NULL → 视为明文 UTF-8，直接转 string
//   - encryptedToken 非空、nonce 非 NULL → AES-GCM 加密，T11.6 实现；当前返 err
//
// 注意：mattn/go-sqlite3 对 NULL BLOB 的反 Scan 行为是 `[]byte(nil)`，长度 0；
// 对 NOT NULL 但 0 字节的 BLOB 也是长度 0。无法区分两者——但语义上等价（无 token）。
func decodeBotToken(encryptedToken, nonce []byte) (string, error) {
	if len(encryptedToken) == 0 {
		return "", nil
	}
	if len(nonce) == 0 {
		// MVP 明文路径
		return strings.TrimSpace(string(encryptedToken)), nil
	}
	return "", errors.New(
		"encrypted bot token detected but AES-GCM decoder not yet implemented (T11.6); " +
			"re-run agent.applyConfig in plaintext mode for now")
}
