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

// sentInlineMessage 记录 mock bot 收到的一次 SendMessageWithInline 调用。
type sentInlineMessage struct {
	chatID int64
	text   string
	rows   [][]InlineButton
}

// mockBot 是 BotAPI 的测试替身。
type mockBot struct {
	sent      []sentMessage
	sendErr   error
	inline    []sentInlineMessage
	inlineErr error
}

func (m *mockBot) SendMessage(_ context.Context, chatID int64, text string, markup any) error {
	if m.sendErr != nil {
		return m.sendErr
	}
	m.sent = append(m.sent, sentMessage{chatID: chatID, text: text, markup: markup})
	return nil
}

func (m *mockBot) SendMessageWithInline(_ context.Context, chatID int64, text string, rows [][]InlineButton) error {
	if m.inlineErr != nil {
		return m.inlineErr
	}
	m.inline = append(m.inline, sentInlineMessage{chatID: chatID, text: text, rows: rows})
	return nil
}

// lastText 返回最后一条被发送的消息文本；没有则返回空串。
func (m *mockBot) lastText() string {
	if len(m.sent) == 0 {
		return ""
	}
	return m.sent[len(m.sent)-1].text
}

// lastInline 返回最后一次 SendMessageWithInline 调用；没有则返回零值和 false。
func (m *mockBot) lastInline() (sentInlineMessage, bool) {
	if len(m.inline) == 0 {
		return sentInlineMessage{}, false
	}
	return m.inline[len(m.inline)-1], true
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

	t.Run("submenu action 渲染 Inline Keyboard", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action: ActionSubmenu,
			Text:   "请选一个：",
			Path:   "row0.btn1",
			Submenu: []RowSpec{
				{Buttons: []ButtonSpec{
					{Action: ActionURL, Text: "官网", URL: "https://x"},
					{Action: ActionText, Text: "说明", Message: "m"},
				}},
				{Buttons: []ButtonSpec{
					{Action: ActionURL, Text: "帮助", URL: "https://y"},
					{Action: ActionText, Text: "联系", Message: "n"},
				}},
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// 不应走 SendMessage 路径。
		if len(bot.sent) != 0 {
			t.Errorf("submenu 不应调用 SendMessage，got %d", len(bot.sent))
		}
		msg, ok := bot.lastInline()
		if !ok {
			t.Fatal("expected SendMessageWithInline to be called")
		}
		if msg.chatID != chatID {
			t.Errorf("chatID: want %d, got %d", chatID, msg.chatID)
		}
		if msg.text != "请选一个：" {
			t.Errorf("prompt text: want %q, got %q", "请选一个：", msg.text)
		}
		// 2 行用户按钮 + 1 行返回按钮 = 3 行
		if len(msg.rows) != 3 {
			t.Fatalf("rows: want 3, got %d", len(msg.rows))
		}
		// 第 0 行第 0 列：menu:row0.btn1.row0.btn0
		if got := msg.rows[0][0].CallbackData; got != "menu:row0.btn1.row0.btn0" {
			t.Errorf("row0 btn0 callback_data: got %q", got)
		}
		if got := msg.rows[0][0].Text; got != "官网" {
			t.Errorf("row0 btn0 text: got %q", got)
		}
		// 第 0 行第 1 列：menu:row0.btn1.row0.btn1
		if got := msg.rows[0][1].CallbackData; got != "menu:row0.btn1.row0.btn1" {
			t.Errorf("row0 btn1 callback_data: got %q", got)
		}
		// 第 1 行第 0 列：menu:row0.btn1.row1.btn0
		if got := msg.rows[1][0].CallbackData; got != "menu:row0.btn1.row1.btn0" {
			t.Errorf("row1 btn0 callback_data: got %q", got)
		}
		// 第 1 行第 1 列：menu:row0.btn1.row1.btn1
		if got := msg.rows[1][1].CallbackData; got != "menu:row0.btn1.row1.btn1" {
			t.Errorf("row1 btn1 callback_data: got %q", got)
		}
		// 最后一行：🔙 返回按钮
		if len(msg.rows[2]) != 1 {
			t.Fatalf("back row should have exactly 1 button, got %d", len(msg.rows[2]))
		}
		if got := msg.rows[2][0].Text; got != "🔙 返回" {
			t.Errorf("back button text: got %q", got)
		}
		if got := msg.rows[2][0].CallbackData; got != "menu:back" {
			t.Errorf("back button callback_data: got %q", got)
		}
	})

	t.Run("submenu 空 Text 用 '请选择：' 兜底", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action: ActionSubmenu,
			Path:   "row0.btn0",
			Submenu: []RowSpec{
				{Buttons: []ButtonSpec{{Action: ActionText, Text: "x", Message: "m"}}},
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		msg, ok := bot.lastInline()
		if !ok {
			t.Fatal("expected inline send")
		}
		if msg.text != "请选择：" {
			t.Errorf("fallback prompt: want %q, got %q", "请选择：", msg.text)
		}
	})

	t.Run("submenu 子按钮空 Text 用 '(未命名)' 兜底", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action: ActionSubmenu,
			Text:   "p",
			Path:   "row0.btn0",
			Submenu: []RowSpec{
				{Buttons: []ButtonSpec{
					{Action: ActionText, Text: "   ", Message: "m"}, // 全空白
					{Action: ActionText, Text: "", Message: "n"},    // 空串
				}},
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		msg, ok := bot.lastInline()
		if !ok {
			t.Fatal("expected inline send")
		}
		if got := msg.rows[0][0].Text; got != "(未命名)" {
			t.Errorf("empty text fallback: got %q", got)
		}
		if got := msg.rows[0][1].Text; got != "(未命名)" {
			t.Errorf("empty text fallback: got %q", got)
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

	t.Run("submenu 缺失 Path 返回 ErrMissingPath", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action: ActionSubmenu,
			// Path 空
			Submenu: []RowSpec{
				{Buttons: []ButtonSpec{{Action: ActionText, Message: "x"}}},
			},
		})
		if !errors.Is(err, ErrMissingPath) {
			t.Fatalf("expected ErrMissingPath, got %v", err)
		}
		if len(bot.inline) != 0 {
			t.Errorf("no inline send on validation error, got %d", len(bot.inline))
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

	t.Run("SendMessageWithInline 返回错误时 Dispatch 冒泡", func(t *testing.T) {
		boom := errors.New("inline boom")
		bot := &mockBot{inlineErr: boom}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), 1, ButtonSpec{
			Action: ActionSubmenu,
			Path:   "row0.btn0",
			Submenu: []RowSpec{
				{Buttons: []ButtonSpec{{Action: ActionText, Text: "x", Message: "m"}}},
			},
		})
		if !errors.Is(err, boom) {
			t.Fatalf("expected inline boom to bubble up, got %v", err)
		}
	})
}

// --- callback_data 编码 ---

func TestBuildCallbackData(t *testing.T) {
	t.Run("根层按钮", func(t *testing.T) {
		got, err := buildCallbackData("row0.btn1", 0, 0)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if want := "menu:row0.btn1.row0.btn0"; got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("嵌套 path", func(t *testing.T) {
		got, err := buildCallbackData("row0.btn1.row2.btn3", 4, 5)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if want := "menu:row0.btn1.row2.btn3.row4.btn5"; got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	// 64 字节边界：
	//   "menu:" (5) + parentPath (49) + ".row0.btn0" (10) = 64 字节
	// parentPath 由 5 段拼接：
	//   "row0.btn1" (9) + ".row0.btn1" × 4 (10 × 4 = 40) = 49 字节
	t.Run("刚好 64 字节通过", func(t *testing.T) {
		parent := "row0.btn1.row0.btn1.row0.btn1.row0.btn1.row0.btn1" // 49 字节
		if len(parent) != 49 {
			t.Fatalf("parent length mismatch: %d", len(parent))
		}
		got, err := buildCallbackData(parent, 0, 0)
		if err != nil {
			t.Fatalf("expected no error at 64 bytes, got %v", err)
		}
		if len(got) != 64 {
			t.Errorf("expected exactly 64 bytes, got %d (%q)", len(got), got)
		}
	})

	// 65 字节：在上面的 49 字节基础上把第 1 段 btn1 改为 btn10，parentPath 变为 50 字节。
	t.Run("超过 64 字节返回 ErrCallbackTooLong", func(t *testing.T) {
		parent := "row0.btn10.row0.btn1.row0.btn1.row0.btn1.row0.btn1" // 50 字节
		if len(parent) != 50 {
			t.Fatalf("parent length mismatch: %d", len(parent))
		}
		_, err := buildCallbackData(parent, 0, 0)
		if !errors.Is(err, ErrCallbackTooLong) {
			t.Fatalf("expected ErrCallbackTooLong, got %v", err)
		}
		// 错误信息应带字节数与完整字符串以便排查。
		if !strings.Contains(err.Error(), "65") {
			t.Errorf("expected byte count in error: %v", err)
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

// --- handleSubmenu 集成：64 字节超限时 Dispatch 冒泡 ErrCallbackTooLong ---

func TestDispatch_SubmenuCallbackTooLong(t *testing.T) {
	bot := &mockBot{}
	d := NewDispatcher(bot)
	// 50 字节 parent + ".row0.btn0" (10) + "menu:" (5) = 65 字节，超过限制
	longPath := "row0.btn10.row0.btn1.row0.btn1.row0.btn1.row0.btn1"
	err := d.Dispatch(context.Background(), 1, ButtonSpec{
		Action: ActionSubmenu,
		Text:   "p",
		Path:   longPath,
		Submenu: []RowSpec{
			{Buttons: []ButtonSpec{{Action: ActionText, Text: "x", Message: "m"}}},
		},
	})
	if !errors.Is(err, ErrCallbackTooLong) {
		t.Fatalf("expected ErrCallbackTooLong, got %v", err)
	}
	if len(bot.inline) != 0 {
		t.Errorf("no inline send on callback overflow, got %d", len(bot.inline))
	}
}
