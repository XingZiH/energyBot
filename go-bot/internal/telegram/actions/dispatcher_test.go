package actions

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// sentMessage 记录 mock bot 收到的一次 SendMessage 调用。
type sentMessage struct {
	chatID int64
	text   string
	markup any
}

// mockBot 是 BotAPI 的测试替身。
type mockBot struct {
	sent    []sentMessage
	sendErr error
}

func (m *mockBot) SendMessage(_ context.Context, chatID int64, text string, markup any) error {
	if m.sendErr != nil {
		return m.sendErr
	}
	m.sent = append(m.sent, sentMessage{chatID: chatID, text: text, markup: markup})
	return nil
}

// lastText 返回最后一条被发送的消息文本；没有则返回空串。
func (m *mockBot) lastText() string {
	if len(m.sent) == 0 {
		return ""
	}
	return m.sent[len(m.sent)-1].text
}

// --- Dispatch 正向路径 ---

func TestDispatch_Routing(t *testing.T) {
	const chatID int64 = 42

	t.Run("url action 发送 URL 文本", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action: ActionURL,
			URL:    "https://example.com",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(bot.sent) != 1 {
			t.Fatalf("expected 1 message, got %d", len(bot.sent))
		}
		if !strings.Contains(bot.lastText(), "example.com") {
			t.Errorf("expected URL in message, got %q", bot.lastText())
		}
	})

	t.Run("url action 空 URL 兜底文案", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		if err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionURL}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bot.lastText() == "" {
			t.Error("expected fallback text for empty URL")
		}
	})

	t.Run("text action 发送 Message", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action:  ActionText,
			Message: "你好世界",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bot.lastText() != "你好世界" {
			t.Errorf("expected 你好世界, got %q", bot.lastText())
		}
	})

	t.Run("text action 空 Message 回落默认", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		if err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionText}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bot.lastText() == "" {
			t.Error("expected non-empty fallback text")
		}
	})

	t.Run("command action 返回待接入占位", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action:  ActionCommand,
			Command: "/start",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(bot.lastText(), "待接入") {
			t.Errorf("expected 待接入 marker, got %q", bot.lastText())
		}
		if !strings.Contains(bot.lastText(), "/start") {
			t.Errorf("expected command name in message, got %q", bot.lastText())
		}
	})

	t.Run("start action 返回待接入占位", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionStart})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(bot.lastText(), "待接入") {
			t.Errorf("expected 待接入 marker, got %q", bot.lastText())
		}
	})

	t.Run("energy_package_group action 返回待接入占位", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action: ActionEnergyPackageGroup,
			PackageGroup: &PackageGroupSpec{
				PackageIDs: []int{1, 2, 3},
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(bot.lastText(), "待接入") {
			t.Errorf("expected 待接入 marker, got %q", bot.lastText())
		}
		if !strings.Contains(bot.lastText(), "3") {
			t.Errorf("expected package count in message, got %q", bot.lastText())
		}
	})

	t.Run("address_manage action 返回待接入占位", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionAddressManage})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(bot.lastText(), "待接入") {
			t.Errorf("expected 待接入 marker, got %q", bot.lastText())
		}
	})

	t.Run("wallet_query action 返回待接入占位", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionWalletQuery})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(bot.lastText(), "待接入") {
			t.Errorf("expected 待接入 marker, got %q", bot.lastText())
		}
	})

	t.Run("orders action 返回待接入占位", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionOrders})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(bot.lastText(), "待接入") {
			t.Errorf("expected 待接入 marker, got %q", bot.lastText())
		}
	})

	t.Run("submenu action 返回待接入占位", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action: ActionSubmenu,
			Submenu: []RowSpec{
				{Buttons: []ButtonSpec{{Action: ActionURL, URL: "https://x"}}},
				{Buttons: []ButtonSpec{{Action: ActionText, Message: "x"}}},
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(bot.lastText(), "待接入") {
			t.Errorf("expected 待接入 marker, got %q", bot.lastText())
		}
		if !strings.Contains(bot.lastText(), "2") {
			t.Errorf("expected submenu item count in message, got %q", bot.lastText())
		}
	})
}

// --- 参数校验 ---

func TestDispatch_Validation(t *testing.T) {
	const chatID int64 = 42

	t.Run("空 Action 返回 ErrEmptyAction", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ""})
		if !errors.Is(err, ErrEmptyAction) {
			t.Fatalf("expected ErrEmptyAction, got %v", err)
		}
		if len(bot.sent) != 0 {
			t.Errorf("no message should be sent on validation error, got %d", len(bot.sent))
		}
	})

	t.Run("未知 Action 返回 ErrUnknownAction", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: "totally_unknown_xyz"})
		if !errors.Is(err, ErrUnknownAction) {
			t.Fatalf("expected ErrUnknownAction, got %v", err)
		}
		if !strings.Contains(err.Error(), "totally_unknown_xyz") {
			t.Errorf("expected unknown action name in error: %v", err)
		}
	})

	t.Run("submenu 为空返回 ErrEmptySubmenu", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action:  ActionSubmenu,
			Submenu: nil,
		})
		if !errors.Is(err, ErrEmptySubmenu) {
			t.Fatalf("expected ErrEmptySubmenu, got %v", err)
		}
	})

	t.Run("package_group 为 nil 返回 ErrInvalidPackageGroup", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action:       ActionEnergyPackageGroup,
			PackageGroup: nil,
		})
		if !errors.Is(err, ErrInvalidPackageGroup) {
			t.Fatalf("expected ErrInvalidPackageGroup, got %v", err)
		}
	})

	t.Run("package_group 的 PackageIDs 为空返回 ErrInvalidPackageGroup", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action: ActionEnergyPackageGroup,
			PackageGroup: &PackageGroupSpec{
				PackageIDs: []int{},
			},
		})
		if !errors.Is(err, ErrInvalidPackageGroup) {
			t.Fatalf("expected ErrInvalidPackageGroup, got %v", err)
		}
	})
}

// --- 错误冒泡 ---

func TestDispatch_BotErrorBubbles(t *testing.T) {
	t.Run("SendMessage 返回错误时 Dispatch 冒泡", func(t *testing.T) {
		boom := errors.New("boom")
		bot := &mockBot{sendErr: boom}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), 1, ButtonSpec{
			Action:  ActionText,
			Message: "hi",
		})
		if !errors.Is(err, boom) {
			t.Fatalf("expected boom to bubble up, got %v", err)
		}
	})
}

// --- 构造函数 ---

func TestNewDispatcher(t *testing.T) {
	t.Run("非 nil bot 返回可用 Dispatcher", func(t *testing.T) {
		// 仅确认 NewDispatcher 对非 nil 输入返回可用实例；nil bot 的守卫行为不在此约束。
		d := NewDispatcher(&mockBot{})
		if d == nil {
			t.Fatal("NewDispatcher returned nil")
		}
	})
}
