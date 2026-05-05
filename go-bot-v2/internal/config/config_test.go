package config

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestLoadEnvReportsMissingRequiredValues(t *testing.T) {
	_, err := Load(EnvMap{})
	if err == nil {
		t.Fatal("expected missing required values error")
	}

	message := err.Error()
	for _, key := range []string{
		"DATABASE_URL",
		"TELEGRAM_BOT_TOKEN",
		"TRON_API_BASE_URL",
		"TRON_API_KEY",
		"PLATFORM_RECEIVE_ADDRESS",
		"JUSTLEND_CONTRACT_ADDRESS",
		"JUSTLEND_PAYER_PRIVATE_KEY",
	} {
		if !strings.Contains(message, key) {
			t.Fatalf("expected error to mention %s, got %q", key, message)
		}
	}
}

func TestLoadEnvLoadsValidValues(t *testing.T) {
	cfg, err := Load(validEnv())
	if err != nil {
		t.Fatalf("expected valid config, got error: %v", err)
	}

	if cfg.DatabaseURL != "postgres://bot:pass@localhost:5432/app" {
		t.Fatalf("unexpected database url: %s", cfg.DatabaseURL)
	}
	if cfg.BotStatus != "enabled" {
		t.Fatalf("unexpected bot status: %s", cfg.BotStatus)
	}
	if cfg.TelegramBotToken != "telegram-token" {
		t.Fatalf("unexpected telegram token: %s", cfg.TelegramBotToken)
	}
	if cfg.TronAPIBaseURL != "https://api.trongrid.io" {
		t.Fatalf("unexpected tron base url: %s", cfg.TronAPIBaseURL)
	}
	if cfg.TronAPIKey != "tron-api-key" {
		t.Fatalf("unexpected tron api key: %s", cfg.TronAPIKey)
	}
	if cfg.PlatformReceiveAddress != "TReceiveAddress" {
		t.Fatalf("unexpected receive address: %s", cfg.PlatformReceiveAddress)
	}
	if cfg.JustLendContractAddress != "TJustLendContract" {
		t.Fatalf("unexpected JustLend contract address: %s", cfg.JustLendContractAddress)
	}
	if cfg.JustLendPayerPrivateKey != "private-key-placeholder" {
		t.Fatalf("unexpected payer private key: %s", cfg.JustLendPayerPrivateKey)
	}
	if cfg.OrderPaymentTTL != 30*time.Minute {
		t.Fatalf("unexpected order payment ttl: %s", cfg.OrderPaymentTTL)
	}
	if cfg.EnergyRentalTTL != time.Hour {
		t.Fatalf("unexpected energy rental ttl: %s", cfg.EnergyRentalTTL)
	}
	if cfg.TelegramPollingInterval != 3*time.Second {
		t.Fatalf("unexpected telegram polling interval: %s", cfg.TelegramPollingInterval)
	}
	if cfg.WorkerInterval != 2*time.Minute {
		t.Fatalf("unexpected worker interval: %s", cfg.WorkerInterval)
	}
	if cfg.MinTRXReserveSun != "0" {
		t.Fatalf("unexpected min reserve: %s", cfg.MinTRXReserveSun)
	}
}

func TestLoadEnvNormalizesPrismaDatabaseURLSchema(t *testing.T) {
	env := validEnv()
	env["DATABASE_URL"] = "postgresql://bot:pass@localhost:5432/app?schema=public"

	cfg, err := Load(env)
	if err != nil {
		t.Fatalf("expected valid config, got error: %v", err)
	}

	if cfg.DatabaseURL != "postgresql://bot:pass@localhost:5432/app?search_path=public" {
		t.Fatalf("unexpected normalized database url: %s", cfg.DatabaseURL)
	}
}

func TestLoadEnvUsesDefaultDurations(t *testing.T) {
	env := validEnv()
	delete(env, "ORDER_PAYMENT_TTL")
	delete(env, "ENERGY_RENTAL_TTL")
	delete(env, "TELEGRAM_POLLING_INTERVAL")
	delete(env, "WORKER_INTERVAL")

	cfg, err := Load(env)
	if err != nil {
		t.Fatalf("expected valid config with defaults, got error: %v", err)
	}

	if cfg.OrderPaymentTTL != 10*time.Minute {
		t.Fatalf("unexpected default order payment ttl: %s", cfg.OrderPaymentTTL)
	}
	if cfg.EnergyRentalTTL != time.Hour {
		t.Fatalf("unexpected default energy rental ttl: %s", cfg.EnergyRentalTTL)
	}
	if cfg.TelegramPollingInterval != 2*time.Second {
		t.Fatalf("unexpected default telegram polling interval: %s", cfg.TelegramPollingInterval)
	}
	if cfg.WorkerInterval != time.Minute {
		t.Fatalf("unexpected default worker interval: %s", cfg.WorkerInterval)
	}
}

func TestLoadFromDatabaseLoadsAdminPlatformConfig(t *testing.T) {
	cfg, err := LoadFromDatabase(context.Background(), EnvMap{
		"DATABASE_URL": "postgres://bot:pass@localhost:5432/app?schema=public",
	}, fakeStore{row: fakeRow{values: []any{
		"https://api.trongrid.io",
		"tron-api-key",
		"TReceiveAddress",
		"TJustLendContract",
		"private-key-placeholder",
		int32(10),
		int32(2),
		int32(60),
		"1000000",
		"justlend",
		"nile",
		"https://api.catfee.io",
		"",
		"",
		"https://nile.catfee.io",
		"",
		"",
		true,
		[]byte("telegram-token"), // encrypted_token，MVP 明文
		[]byte(nil),               // encrypted_token_nonce NULL
	}}})
	if err != nil {
		t.Fatalf("expected valid database config, got error: %v", err)
	}

	if cfg.DatabaseURL != "postgres://bot:pass@localhost:5432/app?search_path=public" {
		t.Fatalf("unexpected database url: %s", cfg.DatabaseURL)
	}
	if cfg.BotStatus != "enabled" {
		t.Fatalf("unexpected bot status: %s", cfg.BotStatus)
	}
	if cfg.TelegramBotToken != "telegram-token" {
		t.Fatalf("unexpected telegram token: %s", cfg.TelegramBotToken)
	}
	if cfg.OrderPaymentTTL != 10*time.Minute {
		t.Fatalf("unexpected order ttl: %s", cfg.OrderPaymentTTL)
	}
	if cfg.EnergyRentalTTL != time.Hour {
		t.Fatalf("unexpected rental ttl: %s", cfg.EnergyRentalTTL)
	}
	if cfg.TelegramPollingInterval != 2*time.Second {
		t.Fatalf("unexpected polling interval: %s", cfg.TelegramPollingInterval)
	}
	if cfg.WorkerInterval != time.Minute {
		t.Fatalf("unexpected worker interval: %s", cfg.WorkerInterval)
	}
	if cfg.MinTRXReserveSun != "1000000" {
		t.Fatalf("unexpected min reserve: %s", cfg.MinTRXReserveSun)
	}
}

func TestLoadFromDatabaseRequiresDatabaseURL(t *testing.T) {
	_, err := LoadFromDatabase(context.Background(), EnvMap{}, fakeStore{})
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("expected DATABASE_URL error, got %v", err)
	}
}

func TestLoadFromDatabaseRequiresPlatformSecrets(t *testing.T) {
	// token=空 → BotStatus 推为 disabled，不会再触发 TELEGRAM_BOT_TOKEN missing 错；
	// 现在改为：缺 PLATFORM_RECEIVE_ADDRESS 应该报错（核心业务字段）。
	_, err := LoadFromDatabase(context.Background(), EnvMap{
		"DATABASE_URL": "postgres://bot:pass@localhost:5432/app",
	}, fakeStore{row: fakeRow{values: []any{
		"https://api.trongrid.io",
		"tron-api-key",
		"", // PlatformReceiveAddress 缺失
		"TJustLendContract",
		"private-key-placeholder",
		int32(10),
		int32(2),
		int32(60),
		"0",
		"justlend",
		"nile",
		"https://api.catfee.io",
		"",
		"",
		"https://nile.catfee.io",
		"",
		"",
		true,
		[]byte("telegram-token"),
		[]byte(nil),
	}}})
	if err == nil || !strings.Contains(err.Error(), "PLATFORM_RECEIVE_ADDRESS") {
		t.Fatalf("expected PLATFORM_RECEIVE_ADDRESS error, got %v", err)
	}
}

// TestLoadFromDatabaseAllowsDisabledPlatformBotWithoutTelegramToken：
// MVP 单租户语义下，token=NULL 视为 BotStatus=disabled，validateRuntimeConfig
// 应不报 token missing。
func TestLoadFromDatabaseAllowsDisabledPlatformBotWithoutTelegramToken(t *testing.T) {
	cfg, err := LoadFromDatabase(context.Background(), EnvMap{
		"DATABASE_URL": "postgres://bot:pass@localhost:5432/app",
	}, fakeStore{row: fakeRow{values: []any{
		"https://api.trongrid.io",
		"tron-api-key",
		"TReceiveAddress",
		"TJustLendContract",
		"private-key-placeholder",
		int32(10),
		int32(2),
		int32(60),
		"0",
		"justlend",
		"nile",
		"https://api.catfee.io",
		"",
		"",
		"https://nile.catfee.io",
		"",
		"",
		true,
		[]byte(nil), // token NULL
		[]byte(nil),
	}}})
	if err != nil {
		t.Fatalf("expected disabled bot config to load without telegram token, got %v", err)
	}
	if cfg.BotStatus != "disabled" {
		t.Fatalf("unexpected bot status: %s", cfg.BotStatus)
	}
}

func TestLoadFromDatabaseAllowsCatFeeNileWithoutJustLendSecrets(t *testing.T) {
	cfg, err := LoadFromDatabase(context.Background(), EnvMap{
		"DATABASE_URL": "postgres://bot:pass@localhost:5432/app",
	}, fakeStore{row: fakeRow{values: []any{
		"https://api.trongrid.io",
		"tron-api-key",
		"TReceiveAddress",
		"",
		"",
		int32(10),
		int32(2),
		int32(60),
		"0",
		"catfee",
		"nile",
		"https://api.catfee.io",
		"",
		"",
		"https://nile.catfee.io",
		"nile-key",
		"nile-secret",
		true,
		[]byte("telegram-token"),
		[]byte(nil),
	}}})
	if err != nil {
		t.Fatalf("expected CatFee config to load without JustLend secrets, got %v", err)
	}

	if cfg.EnergyProvider != "catfee" {
		t.Fatalf("unexpected provider: %s", cfg.EnergyProvider)
	}
	if cfg.CatFeeAPIBaseURL() != "https://nile.catfee.io" {
		t.Fatalf("unexpected active CatFee base url: %s", cfg.CatFeeAPIBaseURL())
	}
	if cfg.CatFeeAPIKey() != "nile-key" || cfg.CatFeeAPISecret() != "nile-secret" {
		t.Fatalf("unexpected active CatFee credentials")
	}
	if !cfg.CatFeeAutoActivate {
		t.Fatal("expected CatFee auto activate to load")
	}
}

// TestLoadFromDatabase_RejectsEncryptedTokenWithoutDecoder（T11.6 之前）：
// nonce 非 NULL 表示密文，当前未实现 AES-GCM 应该返显式错让人去 T11.6。
func TestLoadFromDatabase_RejectsEncryptedTokenWithoutDecoder(t *testing.T) {
	_, err := LoadFromDatabase(context.Background(), EnvMap{
		"DATABASE_URL": "postgres://bot:pass@localhost:5432/app",
	}, fakeStore{row: fakeRow{values: []any{
		"https://api.trongrid.io",
		"tron-api-key",
		"TReceiveAddress",
		"TJustLendContract",
		"private-key-placeholder",
		int32(10),
		int32(2),
		int32(60),
		"0",
		"justlend",
		"nile",
		"https://api.catfee.io",
		"",
		"",
		"https://nile.catfee.io",
		"",
		"",
		true,
		[]byte("ciphertext"),
		[]byte("nonce-12-bytes"),
	}}})
	if err == nil || !strings.Contains(err.Error(), "AES-GCM") {
		t.Fatalf("expected AES-GCM not implemented error, got %v", err)
	}
}

func TestCatFeeCredentialsCanBeSelectedByOrderEnvironment(t *testing.T) {
	cfg := Config{
		CatFeeEnvironment:    "prod",
		CatFeeProdAPIBaseURL: "https://api.catfee.io/",
		CatFeeProdAPIKey:     "prod-key",
		CatFeeProdAPISecret:  "prod-secret",
		CatFeeNileAPIBaseURL: "https://nile.catfee.io/",
		CatFeeNileAPIKey:     "nile-key",
		CatFeeNileAPISecret:  "nile-secret",
	}

	if got := cfg.CatFeeAPIBaseURLFor("nile"); got != "https://nile.catfee.io" {
		t.Fatalf("unexpected Nile base url: %s", got)
	}
	if got := cfg.CatFeeAPIKeyFor("nile"); got != "nile-key" {
		t.Fatalf("unexpected Nile api key: %s", got)
	}
	if got := cfg.CatFeeAPISecretFor("nile"); got != "nile-secret" {
		t.Fatalf("unexpected Nile api secret: %s", got)
	}
	if got := cfg.CatFeeAPIBaseURLFor("production"); got != "https://api.catfee.io" {
		t.Fatalf("unexpected production base url: %s", got)
	}
	if got := cfg.CatFeeAPIKeyFor(""); got != "prod-key" {
		t.Fatalf("empty order environment should fall back to active environment, got %s", got)
	}
}

func validEnv() EnvMap {
	return EnvMap{
		"DATABASE_URL":               "postgres://bot:pass@localhost:5432/app",
		"TELEGRAM_BOT_TOKEN":         "telegram-token",
		"TRON_API_BASE_URL":          "https://api.trongrid.io",
		"TRON_API_KEY":               "tron-api-key",
		"PLATFORM_RECEIVE_ADDRESS":   "TReceiveAddress",
		"JUSTLEND_CONTRACT_ADDRESS":  "TJustLendContract",
		"JUSTLEND_PAYER_PRIVATE_KEY": "private-key-placeholder",
		"ORDER_PAYMENT_TTL":          "30m",
		"ENERGY_RENTAL_TTL":          "1h",
		"TELEGRAM_POLLING_INTERVAL":  "3s",
		"WORKER_INTERVAL":            "2m",
	}
}

type fakeStore struct {
	row fakeRow
}

func (s fakeStore) QueryRow(context.Context, string, ...any) RowScanner {
	return s.row
}

type fakeRow struct {
	values []any
	err    error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != len(r.values) {
		return errors.New("destination count does not match values")
	}
	for i, value := range r.values {
		switch target := dest[i].(type) {
		case *string:
			*target = value.(string)
		case *int32:
			*target = value.(int32)
		case *bool:
			*target = value.(bool)
		case *[]byte:
			// BLOB 列：value 可能是 []byte(nil)（NULL）或 []byte("...")（非空）
			if v, ok := value.([]byte); ok {
				*target = v
			} else {
				return errors.New("expected []byte for BLOB column")
			}
		default:
			return errors.New("unsupported scan target")
		}
	}
	return nil
}
