package telegram

import (
	"strings"
	"testing"
	"time"
)

func TestPackageMenuTextShowsRichChineseLayout(t *testing.T) {
	text := packageMenuText([]EnergyPackage{
		{
			ID:            5,
			PackageName:   "130k能量/1小时",
			EnergyAmount:  130000,
			DurationHours: 1,
			PriceSun:      "2000000",
		},
	}, 10*time.Minute)

	for _, want := range []string{
		"💚 1小时能量自动租赁",
		"📌 当前可选套餐",
		"⚡ 130k能量/1小时",
		"💰 2 TRX",
		"⏳ 支付有效期：10 分钟",
		"💳 你只需要支付套餐售价",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("menu text should contain %q, got:\n%s", want, text)
		}
	}
	if strings.Contains(text, "平台承担质押") {
		t.Fatalf("menu text should not mention platform pledge copy, got:\n%s", text)
	}
}

func TestMainReplyKeyboardContainsControlAndPackageButtons(t *testing.T) {
	keyboard := mainReplyKeyboard([]EnergyPackage{
		{PackageName: "130k能量/1小时"},
		{PackageName: "64k能量/1小时"},
	})

	if !keyboard.ResizeKeyboard {
		t.Fatal("reply keyboard should request resize")
	}
	if len(keyboard.Keyboard) != 5 {
		t.Fatalf("expected 5 keyboard rows, got %d", len(keyboard.Keyboard))
	}

	assertButtonText(t, keyboard.Keyboard[0], 0, "🔥 1小时特价能量")
	assertButtonText(t, keyboard.Keyboard[1], 0, "📍 地址管理")
	assertButtonText(t, keyboard.Keyboard[1], 1, "🔎 钱包查询")
	assertButtonText(t, keyboard.Keyboard[2], 0, "🔔 监听列表")
	assertButtonText(t, keyboard.Keyboard[2], 1, "💱 兑换TRX")
	assertButtonText(t, keyboard.Keyboard[3], 0, "130k能量/1小时")
	assertButtonText(t, keyboard.Keyboard[3], 1, "64k能量/1小时")
	assertButtonText(t, keyboard.Keyboard[4], 0, "🔄 刷新套餐")
}

func TestAddressManagementTextShowsLimitAndSavedAddresses(t *testing.T) {
	text := addressManagementText([]UserAddress{
		{ID: 1, Label: "主钱包", Address: "TReceiver1111111111111111111111111111", IsDefault: true},
		{ID: 2, Label: "备用钱包", Address: "TReceiver2222222222222222222222222222"},
	})

	for _, want := range []string{
		"📍 地址管理",
		"已绑定 2/10 个地址",
		"⭐ 主钱包",
		"备用钱包",
		"新增、修改、删除都在下方按钮操作",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("address management text should contain %q, got:\n%s", want, text)
		}
	}
}

func TestAddressSelectionTextRequiresSavedAddress(t *testing.T) {
	text := addressSelectionText(EnergyPackage{
		PackageName:   "130k能量/1小时",
		EnergyAmount:  130000,
		DurationHours: 1,
		PriceSun:      "2000000",
	}, nil)

	for _, want := range []string{
		"请先在地址管理里新增接收地址",
		"每个用户最多可绑定 10 个地址",
		"130k能量/1小时",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("address selection text should contain %q, got:\n%s", want, text)
		}
	}
}

func TestPaymentTextUsesCardStyleAndPaymentAddress(t *testing.T) {
	text := paymentOrderText(createdOrderDetail{
		OrderNo:         "ER20260428164500ABCDEF",
		PackageName:     "130k能量/1小时",
		EnergyAmount:    130000,
		DurationHours:   1,
		PriceSun:        "2000000",
		ReceiveAddress:  "TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk",
		ReceiverAddress: "TReceiver1111111111111111111111111111",
		TTL:             10 * time.Minute,
	})

	for _, want := range []string{
		"🔥 1小时特价能量",
		"✅ 支付订单已生成",
		"💰 应付金额：2 TRX",
		"📮 收款地址",
		"TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk",
		"📥 能量接收地址",
		"⏳ 请在10分钟内付款",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("payment text should contain %q, got:\n%s", want, text)
		}
	}
}

func TestWalletSnapshotTextShowsAssetsAndResources(t *testing.T) {
	text := walletSnapshotText(WalletSnapshot{
		Address:                    "TNV4d8hvJz7h9XEK9DeRYG4H2YFXChNLAV",
		BalanceSun:                 5_633_724,
		EnergyUsed:                 129_580,
		EnergyLimit:                129_999,
		FreeNetUsed:                262,
		FreeNetLimit:               600,
		AcquiredEnergyDelegatedSun: 14_152_939_649,
		Activated:                  true,
	}, "地址1")

	for _, want := range []string{
		"🔎 钱包查询",
		"地址1",
		"TNV4d8...ChNLAV",
		"TRX 可用：5.633724 TRX",
		"能量：419 / 129999",
		"带宽：338 / 600",
		"租入能量质押：14152.939649 TRX",
		"账户状态：已激活",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("wallet text should contain %q, got:\n%s", want, text)
		}
	}
}

func TestWalletQueryKeyboardListsSavedAddresses(t *testing.T) {
	keyboard := walletQueryKeyboard([]UserAddress{
		{ID: 7, Label: "主钱包", Address: "TNV4d8hvJz7h9XEK9DeRYG4H2YFXChNLAV", IsDefault: true},
	})

	if len(keyboard.InlineKeyboard) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(keyboard.InlineKeyboard))
	}
	button := keyboard.InlineKeyboard[0][0]
	if button.CallbackData != "wallet:addr:7" {
		t.Fatalf("unexpected callback data: %s", button.CallbackData)
	}
	if !strings.Contains(button.Text, "主钱包") || !strings.Contains(button.Text, "TNV4d8...ChNLAV") {
		t.Fatalf("unexpected button text: %s", button.Text)
	}
}

func TestParseWalletQueryAddress(t *testing.T) {
	address := "TNV4d8hvJz7h9XEK9DeRYG4H2YFXChNLAV"
	for _, text := range []string{
		address,
		"查询 " + address,
		"钱包查询 " + address,
		"查钱包：" + address,
	} {
		got, ok := parseWalletQueryAddress(text)
		if !ok || got != address {
			t.Fatalf("expected %q to parse as %s, got %q ok=%v", text, address, got, ok)
		}
	}
}

func TestCurrentPackagePriceSunUsesShanghaiBusyAndIdlePeriods(t *testing.T) {
	cst := time.FixedZone("Asia/Shanghai", 8*60*60)
	pkg := EnergyPackage{
		PriceSun:     "2000000",
		IdlePriceSun: "1755000",
		BusyPriceSun: "2405000",
	}

	cases := []struct {
		name string
		at   time.Time
		want string
	}{
		{name: "morning busy period before ten", at: time.Date(2026, 4, 29, 9, 59, 0, 0, cst), want: "2405000"},
		{name: "idle starts at ten", at: time.Date(2026, 4, 29, 10, 0, 0, 0, cst), want: "1755000"},
		{name: "idle before eight at night", at: time.Date(2026, 4, 29, 19, 59, 0, 0, cst), want: "1755000"},
		{name: "busy starts at eight at night", at: time.Date(2026, 4, 29, 20, 0, 0, 0, cst), want: "2405000"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := currentPackagePriceSun(pkg, tc.at); got != tc.want {
				t.Fatalf("expected %s, got %s", tc.want, got)
			}
		})
	}
}

func TestBotAgentIDParamSeparatesPlatformAndAgentRows(t *testing.T) {
	platformBot := &Bot{}
	if got := platformBot.agentIDParam(); got != nil {
		t.Fatalf("platform bot should scope rows with null agent id, got %#v", got)
	}

	agentBot := &Bot{agentID: 42}
	if got := agentBot.agentIDParam(); got != 42 {
		t.Fatalf("agent bot should scope rows with its agent id, got %#v", got)
	}
}

func TestRedactTelegramTokenFromErrors(t *testing.T) {
	token := "123456789:secret-token"
	raw := `Post "https://api.telegram.org/bot123456789:secret-token/getUpdates": context deadline exceeded`

	got := redactTelegramToken(raw, token)

	if strings.Contains(got, token) {
		t.Fatalf("redacted error should not contain token: %s", got)
	}
	if !strings.Contains(got, "/bot[redacted]/getUpdates") {
		t.Fatalf("redacted error should keep method context, got %s", got)
	}
}

func assertButtonText(t *testing.T, row []keyboardButton, index int, want string) {
	t.Helper()
	if len(row) <= index {
		t.Fatalf("row has %d buttons, missing index %d", len(row), index)
	}
	if row[index].Text != want {
		t.Fatalf("expected button %q, got %q", want, row[index].Text)
	}
}
