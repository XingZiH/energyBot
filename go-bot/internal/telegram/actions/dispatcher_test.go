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

	// 套餐组相关：
	// loadPackages 是 LoadPackagesByIDs 的返回值。若 loadErr 非 nil 则优先返回 error。
	// loadCalledWith 记录最近一次调用传入的 ids，便于断言。
	loadPackages   []PackageInfo
	loadErr        error
	loadCalledWith []int

	// 任务 10B 新增 5 个业务方法的调用记录。
	// *Calls 记录调用次数；last*ChatID 记录最近一次 chatID；
	// lastCommand 记录 RunCommand 最近一次传入的 cmd。
	// 任何一个方法的 err 字段非 nil 时返回错误而不记录 chatID（对齐 SendMessage 语义）。
	showStartCalls        int
	showStartLastChatID   int64
	showStartErr          error
	showAddressCalls      int
	showAddressLastChatID int64
	showAddressErr        error
	showWalletCalls       int
	showWalletLastChatID  int64
	showWalletErr         error
	showOrdersCalls       int
	showOrdersLastChatID  int64
	showOrdersErr         error
	runCommandCalls       int
	runCommandLastChatID  int64
	runCommandLastCmd     string
	runCommandErr         error
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

func (m *mockBot) LoadPackagesByIDs(_ context.Context, ids []int) ([]PackageInfo, error) {
	// 复制一份 ids，避免被调用方后续修改影响断言。
	m.loadCalledWith = append([]int(nil), ids...)
	if m.loadErr != nil {
		return nil, m.loadErr
	}
	return m.loadPackages, nil
}

func (m *mockBot) ShowStart(_ context.Context, chatID int64) error {
	if m.showStartErr != nil {
		return m.showStartErr
	}
	m.showStartCalls++
	m.showStartLastChatID = chatID
	return nil
}

func (m *mockBot) ShowAddressManagement(_ context.Context, chatID int64) error {
	if m.showAddressErr != nil {
		return m.showAddressErr
	}
	m.showAddressCalls++
	m.showAddressLastChatID = chatID
	return nil
}

func (m *mockBot) ShowWalletQuery(_ context.Context, chatID int64) error {
	if m.showWalletErr != nil {
		return m.showWalletErr
	}
	m.showWalletCalls++
	m.showWalletLastChatID = chatID
	return nil
}

func (m *mockBot) ShowOrders(_ context.Context, chatID int64) error {
	if m.showOrdersErr != nil {
		return m.showOrdersErr
	}
	m.showOrdersCalls++
	m.showOrdersLastChatID = chatID
	return nil
}

func (m *mockBot) RunCommand(_ context.Context, chatID int64, cmd string) error {
	if m.runCommandErr != nil {
		return m.runCommandErr
	}
	m.runCommandCalls++
	m.runCommandLastChatID = chatID
	m.runCommandLastCmd = cmd
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

	t.Run("command action 调用 RunCommand 并传递命令字符串", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action:  ActionCommand,
			Command: "/start",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bot.runCommandCalls != 1 {
			t.Fatalf("RunCommand calls: want 1, got %d", bot.runCommandCalls)
		}
		if bot.runCommandLastChatID != chatID {
			t.Errorf("RunCommand chatID: want %d, got %d", chatID, bot.runCommandLastChatID)
		}
		if bot.runCommandLastCmd != "/start" {
			t.Errorf("RunCommand cmd: want %q, got %q", "/start", bot.runCommandLastCmd)
		}
		// 走 RunCommand 路径时不应直接调用 SendMessage。
		if len(bot.sent) != 0 {
			t.Errorf("command action 不应直接调用 SendMessage，got %d", len(bot.sent))
		}
	})

	t.Run("command action 空 Command 返回 ErrEmptyCommand", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action:  ActionCommand,
			Command: "   ",
		})
		if !errors.Is(err, ErrEmptyCommand) {
			t.Fatalf("expected ErrEmptyCommand, got %v", err)
		}
		if bot.runCommandCalls != 0 {
			t.Errorf("RunCommand 不应被调用，got %d", bot.runCommandCalls)
		}
	})

	t.Run("start action 调用 ShowStart", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionStart})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bot.showStartCalls != 1 || bot.showStartLastChatID != chatID {
			t.Errorf("ShowStart: calls=%d chatID=%d (want 1, %d)",
				bot.showStartCalls, bot.showStartLastChatID, chatID)
		}
		if len(bot.sent) != 0 {
			t.Errorf("start action 不应直接调用 SendMessage，got %d", len(bot.sent))
		}
	})

	t.Run("energy_package_group action 渲染套餐列表 Inline Keyboard", func(t *testing.T) {
		bot := &mockBot{
			loadPackages: []PackageInfo{
				{ID: 1, Name: "A", Price: 12.5, Energy: 65000},
				{ID: 2, Name: "B", Price: 8.5, Energy: 32000},
				{ID: 3, Name: "C", Price: 24.0, Energy: 130000},
			},
		}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{
			Action: ActionEnergyPackageGroup,
			Text:   "买套餐",
			PackageGroup: &PackageGroupSpec{
				PackageIDs:   []int{1, 2, 3},
				SortBy:       "price_asc",
				TextTemplate: "{name} ({price} TRX, {energy})",
			},
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// 套餐组不应走 SendMessage 路径（只发 Inline Keyboard）。
		if len(bot.sent) != 0 {
			t.Errorf("package_group 成功场景不应调用 SendMessage，got %d", len(bot.sent))
		}
		msg, ok := bot.lastInline()
		if !ok {
			t.Fatal("expected SendMessageWithInline to be called")
		}
		if msg.chatID != chatID {
			t.Errorf("chatID: want %d, got %d", chatID, msg.chatID)
		}
		if msg.text != "请选择套餐：" {
			t.Errorf("prompt: want %q, got %q", "请选择套餐：", msg.text)
		}
		// LoadPackagesByIDs 应收到原始 ids。
		if want := []int{1, 2, 3}; !equalInts(bot.loadCalledWith, want) {
			t.Errorf("LoadPackagesByIDs ids: want %v, got %v", want, bot.loadCalledWith)
		}
		// 3 个套餐 + 1 行返回 = 4 行
		if len(msg.rows) != 4 {
			t.Fatalf("rows: want 4, got %d", len(msg.rows))
		}
		// 每行应该恰好 1 个按钮（套餐按钮单行展示）。
		for i, row := range msg.rows {
			if len(row) != 1 {
				t.Errorf("row %d should have 1 button, got %d", i, len(row))
			}
		}
		// 按 price 升序：B(8.5) → A(12.5) → C(24.0)
		wantButtons := []struct {
			text string
			cb   string
		}{
			{"B (8.50 TRX, 32000)", "pkg:2"},
			{"A (12.50 TRX, 65000)", "pkg:1"},
			{"C (24.00 TRX, 130000)", "pkg:3"},
		}
		for i, w := range wantButtons {
			if got := msg.rows[i][0].Text; got != w.text {
				t.Errorf("row %d text: want %q, got %q", i, w.text, got)
			}
			if got := msg.rows[i][0].CallbackData; got != w.cb {
				t.Errorf("row %d callback_data: want %q, got %q", i, w.cb, got)
			}
		}
		// 最后一行：返回按钮
		if len(msg.rows[3]) != 1 {
			t.Fatalf("back row should have 1 button, got %d", len(msg.rows[3]))
		}
		if got := msg.rows[3][0].Text; got != "🔙 返回" {
			t.Errorf("back text: got %q", got)
		}
		if got := msg.rows[3][0].CallbackData; got != "menu:back" {
			t.Errorf("back callback_data: got %q", got)
		}
	})

	t.Run("address_manage action 调用 ShowAddressManagement", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionAddressManage})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bot.showAddressCalls != 1 || bot.showAddressLastChatID != chatID {
			t.Errorf("ShowAddressManagement: calls=%d chatID=%d (want 1, %d)",
				bot.showAddressCalls, bot.showAddressLastChatID, chatID)
		}
	})

	t.Run("wallet_query action 调用 ShowWalletQuery", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionWalletQuery})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bot.showWalletCalls != 1 || bot.showWalletLastChatID != chatID {
			t.Errorf("ShowWalletQuery: calls=%d chatID=%d (want 1, %d)",
				bot.showWalletCalls, bot.showWalletLastChatID, chatID)
		}
	})

	t.Run("orders action 调用 ShowOrders", func(t *testing.T) {
		bot := &mockBot{}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), chatID, ButtonSpec{Action: ActionOrders})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if bot.showOrdersCalls != 1 || bot.showOrdersLastChatID != chatID {
			t.Errorf("ShowOrders: calls=%d chatID=%d (want 1, %d)",
				bot.showOrdersCalls, bot.showOrdersLastChatID, chatID)
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

	t.Run("ShowStart 返回错误时 Dispatch 冒泡", func(t *testing.T) {
		boom := errors.New("start boom")
		bot := &mockBot{showStartErr: boom}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), 1, ButtonSpec{Action: ActionStart})
		if !errors.Is(err, boom) {
			t.Fatalf("expected start boom to bubble up, got %v", err)
		}
	})

	t.Run("ShowAddressManagement 返回错误时 Dispatch 冒泡", func(t *testing.T) {
		boom := errors.New("addr boom")
		bot := &mockBot{showAddressErr: boom}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), 1, ButtonSpec{Action: ActionAddressManage})
		if !errors.Is(err, boom) {
			t.Fatalf("expected addr boom to bubble up, got %v", err)
		}
	})

	t.Run("ShowWalletQuery 返回错误时 Dispatch 冒泡", func(t *testing.T) {
		boom := errors.New("wallet boom")
		bot := &mockBot{showWalletErr: boom}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), 1, ButtonSpec{Action: ActionWalletQuery})
		if !errors.Is(err, boom) {
			t.Fatalf("expected wallet boom to bubble up, got %v", err)
		}
	})

	t.Run("ShowOrders 返回错误时 Dispatch 冒泡", func(t *testing.T) {
		boom := errors.New("orders boom")
		bot := &mockBot{showOrdersErr: boom}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), 1, ButtonSpec{Action: ActionOrders})
		if !errors.Is(err, boom) {
			t.Fatalf("expected orders boom to bubble up, got %v", err)
		}
	})

	t.Run("RunCommand 返回错误时 Dispatch 冒泡", func(t *testing.T) {
		boom := errors.New("cmd boom")
		bot := &mockBot{runCommandErr: boom}
		d := NewDispatcher(bot)
		err := d.Dispatch(context.Background(), 1, ButtonSpec{
			Action:  ActionCommand,
			Command: "/start",
		})
		if !errors.Is(err, boom) {
			t.Fatalf("expected cmd boom to bubble up, got %v", err)
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

// --- handleEnergyPackageGroup 专项测试 ---

// equalInts 比较两个 int 切片（顺序敏感）。
func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// pkgRowTextsAndCBs 从 inline 消息里抽出每行第一个按钮的 (text, callback_data)。
// 套餐组每行只有 1 个按钮。
func pkgRowTextsAndCBs(msg sentInlineMessage) [][2]string {
	out := make([][2]string, 0, len(msg.rows))
	for _, row := range msg.rows {
		if len(row) == 0 {
			out = append(out, [2]string{"", ""})
			continue
		}
		out = append(out, [2]string{row[0].Text, row[0].CallbackData})
	}
	return out
}

func TestDispatch_PackageGroup_Sorting(t *testing.T) {
	const chatID int64 = 7
	// 3 个套餐（价格乱序、名字按输入顺序），用于各排序模式对比。
	packages := []PackageInfo{
		{ID: 10, Name: "A", Price: 20.0, Energy: 100000},
		{ID: 11, Name: "B", Price: 5.5, Energy: 30000},
		{ID: 12, Name: "C", Price: 12.3, Energy: 60000},
	}
	ids := []int{10, 11, 12}

	cases := []struct {
		name     string
		sortBy   string
		wantCBs  []string // 按顺序的 callback_data（不含末尾返回按钮）
		wantDesc string
	}{
		{"price_asc 升序", "price_asc", []string{"pkg:11", "pkg:12", "pkg:10"}, "B(5.5) C(12.3) A(20.0)"},
		{"price_desc 降序", "price_desc", []string{"pkg:10", "pkg:12", "pkg:11"}, "A(20.0) C(12.3) B(5.5)"},
		{"manual 保持 PackageIDs 顺序", "manual", []string{"pkg:10", "pkg:11", "pkg:12"}, "按输入 [10,11,12]"},
		{"空 SortBy 默认 price_asc", "", []string{"pkg:11", "pkg:12", "pkg:10"}, "默认升序"},
		{"未知 SortBy 回落 price_asc", "weird_unknown", []string{"pkg:11", "pkg:12", "pkg:10"}, "未知值降级升序"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// 每次都复制一份，避免 sort 就地修改影响下一 case。
			pkgsCopy := append([]PackageInfo(nil), packages...)
			bot := &mockBot{loadPackages: pkgsCopy}
			d := NewDispatcher(bot)
			err := d.Dispatch(context.Background(), chatID, ButtonSpec{
				Action: ActionEnergyPackageGroup,
				PackageGroup: &PackageGroupSpec{
					PackageIDs:   ids,
					SortBy:       c.sortBy,
					TextTemplate: "{name} {price}",
				},
			})
			if err != nil {
				t.Fatalf("[%s] unexpected error: %v", c.wantDesc, err)
			}
			msg, ok := bot.lastInline()
			if !ok {
				t.Fatalf("[%s] expected inline message", c.wantDesc)
			}
			// 套餐按钮 + 返回按钮
			if len(msg.rows) != len(c.wantCBs)+1 {
				t.Fatalf("[%s] rows: want %d, got %d", c.wantDesc, len(c.wantCBs)+1, len(msg.rows))
			}
			got := pkgRowTextsAndCBs(msg)
			for i, want := range c.wantCBs {
				if got[i][1] != want {
					t.Errorf("[%s] row %d callback: want %q, got %q（整体顺序 %v）",
						c.wantDesc, i, want, got[i][1], got)
				}
			}
			// 最后一行：返回按钮
			if got[len(c.wantCBs)][1] != "menu:back" {
				t.Errorf("[%s] last row should be back, got %q", c.wantDesc, got[len(c.wantCBs)][1])
			}
		})
	}
}

func TestDispatch_PackageGroup_EmptyTemplate(t *testing.T) {
	bot := &mockBot{
		loadPackages: []PackageInfo{
			{ID: 1, Name: "标准套餐", Price: 10.0, Energy: 65000},
		},
	}
	d := NewDispatcher(bot)
	err := d.Dispatch(context.Background(), 1, ButtonSpec{
		Action: ActionEnergyPackageGroup,
		PackageGroup: &PackageGroupSpec{
			PackageIDs:   []int{1},
			TextTemplate: "", // 空模板 → 默认 "{name} - {price} TRX"
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	msg, ok := bot.lastInline()
	if !ok {
		t.Fatal("expected inline message")
	}
	// 第 0 行是套餐按钮，第 1 行是返回按钮
	if len(msg.rows) != 2 {
		t.Fatalf("rows: want 2, got %d", len(msg.rows))
	}
	want := "标准套餐 - 10.00 TRX"
	if got := msg.rows[0][0].Text; got != want {
		t.Errorf("default template text: want %q, got %q", want, got)
	}
}

func TestDispatch_PackageGroup_PartialLoad(t *testing.T) {
	// 请求 [1,2,3]，DB 只返回 [1,3]（ID=2 被删除）。
	bot := &mockBot{
		loadPackages: []PackageInfo{
			{ID: 1, Name: "A", Price: 1.0, Energy: 1000},
			{ID: 3, Name: "C", Price: 3.0, Energy: 3000},
		},
	}
	d := NewDispatcher(bot)
	err := d.Dispatch(context.Background(), 1, ButtonSpec{
		Action: ActionEnergyPackageGroup,
		PackageGroup: &PackageGroupSpec{
			PackageIDs:   []int{1, 2, 3},
			SortBy:       "price_asc",
			TextTemplate: "{name}",
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// 不报错，发送 2 套餐 + 返回 = 3 行
	msg, ok := bot.lastInline()
	if !ok {
		t.Fatal("expected inline message")
	}
	if len(msg.rows) != 3 {
		t.Fatalf("rows: want 3 (2 packages + back), got %d", len(msg.rows))
	}
	if got := msg.rows[0][0].CallbackData; got != "pkg:1" {
		t.Errorf("row 0: want pkg:1, got %q", got)
	}
	if got := msg.rows[1][0].CallbackData; got != "pkg:3" {
		t.Errorf("row 1: want pkg:3, got %q", got)
	}
	// 不应发纯文本消息
	if len(bot.sent) != 0 {
		t.Errorf("部分加载成功不应发文本消息，got %d", len(bot.sent))
	}
}

func TestDispatch_PackageGroup_PartialLoad_ManualPreservesRequestOrder(t *testing.T) {
	// manual 排序下，LoadPackagesByIDs 返回顺序被打乱 + 部分缺失；
	// 应按 PackageIDs 原始顺序展示可用项。
	bot := &mockBot{
		loadPackages: []PackageInfo{
			// DB 返回顺序乱序：3、1，缺 2
			{ID: 3, Name: "C", Price: 3.0, Energy: 3000},
			{ID: 1, Name: "A", Price: 1.0, Energy: 1000},
		},
	}
	d := NewDispatcher(bot)
	err := d.Dispatch(context.Background(), 1, ButtonSpec{
		Action: ActionEnergyPackageGroup,
		PackageGroup: &PackageGroupSpec{
			PackageIDs:   []int{1, 2, 3},
			SortBy:       "manual",
			TextTemplate: "{name}",
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	msg, ok := bot.lastInline()
	if !ok {
		t.Fatal("expected inline message")
	}
	// 按原 ids 顺序 [1,2,3]，跳过缺失的 2：应为 pkg:1, pkg:3
	if len(msg.rows) != 3 {
		t.Fatalf("rows: want 3, got %d", len(msg.rows))
	}
	if got := msg.rows[0][0].CallbackData; got != "pkg:1" {
		t.Errorf("row 0: want pkg:1, got %q", got)
	}
	if got := msg.rows[1][0].CallbackData; got != "pkg:3" {
		t.Errorf("row 1: want pkg:3, got %q", got)
	}
}

func TestDispatch_PackageGroup_AllFailed(t *testing.T) {
	// 全部加载失败（空切片，无 error）：发送"套餐暂时不可用"文本消息，不发 inline。
	bot := &mockBot{loadPackages: []PackageInfo{}}
	d := NewDispatcher(bot)
	err := d.Dispatch(context.Background(), 1, ButtonSpec{
		Action: ActionEnergyPackageGroup,
		PackageGroup: &PackageGroupSpec{
			PackageIDs: []int{1, 2},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(bot.inline) != 0 {
		t.Errorf("全部加载失败不应发 Inline Keyboard，got %d", len(bot.inline))
	}
	if len(bot.sent) != 1 {
		t.Fatalf("expect 1 text message for unavailable, got %d", len(bot.sent))
	}
	if !strings.Contains(bot.lastText(), "套餐暂时不可用") {
		t.Errorf("unavailable text: got %q", bot.lastText())
	}
}

func TestDispatch_PackageGroup_LoadError(t *testing.T) {
	boom := errors.New("db down")
	bot := &mockBot{loadErr: boom}
	d := NewDispatcher(bot)
	err := d.Dispatch(context.Background(), 1, ButtonSpec{
		Action: ActionEnergyPackageGroup,
		PackageGroup: &PackageGroupSpec{
			PackageIDs: []int{1},
		},
	})
	if !errors.Is(err, boom) {
		t.Fatalf("expected LoadPackagesByIDs error to bubble, got %v", err)
	}
	// 不应发任何消息
	if len(bot.inline) != 0 || len(bot.sent) != 0 {
		t.Errorf("加载出错时不应发消息")
	}
}

// --- helper 单测 ---

func TestSortPackages(t *testing.T) {
	base := []PackageInfo{
		{ID: 10, Name: "A", Price: 20.0},
		{ID: 11, Name: "B", Price: 5.5},
		{ID: 12, Name: "C", Price: 12.3},
	}

	t.Run("price_asc", func(t *testing.T) {
		got := append([]PackageInfo(nil), base...)
		sortPackages(got, "price_asc")
		wantIDs := []int{11, 12, 10}
		for i, id := range wantIDs {
			if got[i].ID != id {
				t.Errorf("pos %d: want id %d, got %d", i, id, got[i].ID)
			}
		}
	})

	t.Run("price_desc", func(t *testing.T) {
		got := append([]PackageInfo(nil), base...)
		sortPackages(got, "price_desc")
		wantIDs := []int{10, 12, 11}
		for i, id := range wantIDs {
			if got[i].ID != id {
				t.Errorf("pos %d: want id %d, got %d", i, id, got[i].ID)
			}
		}
	})

	t.Run("manual 不改变顺序", func(t *testing.T) {
		got := append([]PackageInfo(nil), base...)
		sortPackages(got, "manual")
		wantIDs := []int{10, 11, 12}
		for i, id := range wantIDs {
			if got[i].ID != id {
				t.Errorf("pos %d: want id %d, got %d", i, id, got[i].ID)
			}
		}
	})

	t.Run("未知 SortBy 回落 price_asc", func(t *testing.T) {
		got := append([]PackageInfo(nil), base...)
		sortPackages(got, "something_unknown")
		wantIDs := []int{11, 12, 10}
		for i, id := range wantIDs {
			if got[i].ID != id {
				t.Errorf("pos %d: want id %d, got %d", i, id, got[i].ID)
			}
		}
	})

	t.Run("空 SortBy 回落 price_asc", func(t *testing.T) {
		got := append([]PackageInfo(nil), base...)
		sortPackages(got, "")
		wantIDs := []int{11, 12, 10}
		for i, id := range wantIDs {
			if got[i].ID != id {
				t.Errorf("pos %d: want id %d, got %d", i, id, got[i].ID)
			}
		}
	})

	t.Run("稳定排序：相等 price 保持原顺序", func(t *testing.T) {
		got := []PackageInfo{
			{ID: 1, Name: "A", Price: 5.0},
			{ID: 2, Name: "B", Price: 5.0},
			{ID: 3, Name: "C", Price: 5.0},
		}
		sortPackages(got, "price_asc")
		for i, wantID := range []int{1, 2, 3} {
			if got[i].ID != wantID {
				t.Errorf("stable asc pos %d: want id %d, got %d", i, wantID, got[i].ID)
			}
		}
	})
}

func TestRenderPackageButtonText(t *testing.T) {
	pkg := PackageInfo{ID: 1, Name: "标准", Price: 12.5, Energy: 65000}

	t.Run("全部变量替换", func(t *testing.T) {
		got := renderPackageButtonText("{name} ({price} TRX, {energy})", pkg)
		want := "标准 (12.50 TRX, 65000)"
		if got != want {
			t.Errorf("want %q, got %q", want, got)
		}
	})

	t.Run("空模板回落默认", func(t *testing.T) {
		got := renderPackageButtonText("", pkg)
		want := "标准 - 12.50 TRX"
		if got != want {
			t.Errorf("want %q, got %q", want, got)
		}
	})

	t.Run("未知变量保留原样（局部白名单外）", func(t *testing.T) {
		// 用全局白名单里的 packageName 测试：套餐组内部模板只认 name/price/energy，
		// 所以 {packageName} 应原样保留。
		got := renderPackageButtonText("{packageName}-{name}", pkg)
		want := "{packageName}-标准"
		if got != want {
			t.Errorf("want %q, got %q", want, got)
		}
	})

	t.Run("price 格式化两位小数", func(t *testing.T) {
		got := renderPackageButtonText("{price}", PackageInfo{Price: 1})
		if got != "1.00" {
			t.Errorf("want %q, got %q", "1.00", got)
		}
	})
}

func TestFilterOrderByIDs(t *testing.T) {
	packages := []PackageInfo{
		{ID: 3, Name: "C"},
		{ID: 1, Name: "A"},
		// 缺 2
	}
	t.Run("按 ids 顺序过滤，跳过缺失", func(t *testing.T) {
		got := filterOrderByIDs(packages, []int{1, 2, 3})
		wantIDs := []int{1, 3}
		if len(got) != len(wantIDs) {
			t.Fatalf("len: want %d, got %d", len(wantIDs), len(got))
		}
		for i, id := range wantIDs {
			if got[i].ID != id {
				t.Errorf("pos %d: want %d, got %d", i, id, got[i].ID)
			}
		}
	})
	t.Run("ids 为空返回空切片", func(t *testing.T) {
		got := filterOrderByIDs(packages, nil)
		if len(got) != 0 {
			t.Errorf("want empty, got %v", got)
		}
	})
	t.Run("全部缺失返回空切片", func(t *testing.T) {
		got := filterOrderByIDs(packages, []int{99, 100})
		if len(got) != 0 {
			t.Errorf("want empty, got %v", got)
		}
	})
}
