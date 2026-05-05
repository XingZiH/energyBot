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
select
  coalesce(bot_status, 'disabled'),
  coalesce(telegram_bot_token, ''),
  coalesce(tron_api_base_url, 'https://api.trongrid.io'),
  coalesce(tron_api_key, ''),
  coalesce(platform_receive_address, ''),
  coalesce(justlend_contract_address, ''),
  coalesce(justlend_payer_private_key, ''),
  coalesce(order_payment_ttl_minutes, 10),
  coalesce(telegram_polling_interval_seconds, 2),
  coalesce(worker_interval_seconds, 60),
  coalesce(min_trx_reserve_sun, 0),
  coalesce(energy_provider, 'justlend'),
  coalesce(catfee_environment, 'nile'),
  coalesce(catfee_prod_api_base_url, 'https://api.catfee.io'),
  coalesce(catfee_prod_api_key, ''),
  coalesce(catfee_prod_api_secret, ''),
  coalesce(catfee_nile_api_base_url, 'https://nile.catfee.io'),
  coalesce(catfee_nile_api_key, ''),
  coalesce(catfee_nile_api_secret, ''),
  coalesce(catfee_auto_activate, true)
from energy_platform_config
where id = 1`

	var (
		cfg                           Config
		orderPaymentTTLMinutes        int32
		telegramPollingIntervalSecond int32
		workerIntervalSeconds         int32
	)
	err := store.QueryRow(ctx, query).Scan(
		&cfg.BotStatus,
		&cfg.TelegramBotToken,
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
	)
	if err != nil {
		return Config{}, fmt.Errorf("load platform config from database: %w", err)
	}

	cfg.DatabaseURL = databaseURL
	cfg.BotStatus = strings.TrimSpace(cfg.BotStatus)
	cfg.TelegramBotToken = strings.TrimSpace(cfg.TelegramBotToken)
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
