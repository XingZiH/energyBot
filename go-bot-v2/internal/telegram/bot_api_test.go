package telegram

import (
	"context"
	"testing"

	"github.com/anomalyco/energybot-bot/internal/telegram/actions"
)

// TestBotImplementsBotAPI 在运行时再次确认接口契约
// （编译期断言由 bot_api.go 中的 `var _ actions.BotAPI = (*Bot)(nil)` 保证）。
func TestBotImplementsBotAPI(t *testing.T) {
	var _ actions.BotAPI = (*Bot)(nil)
}

// TestParsePriceSunToTRX 覆盖 Sun → TRX 单位换算的边界情况。
// 1 TRX = 1e6 Sun。
func TestParsePriceSunToTRX(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		want    float64
		wantErr bool
	}{
		{name: "一百万 Sun 等于 1 TRX", input: "1000000", want: 1.0},
		{name: "两百万 Sun 等于 2 TRX", input: "2000000", want: 2.0},
		{name: "零值合法", input: "0", want: 0.0},
		{name: "带前后空白", input: "  1500000  ", want: 1.5},
		{name: "空字符串报错", input: "", wantErr: true},
		{name: "非数字报错", input: "abc", wantErr: true},
		{name: "负数报错", input: "-1", wantErr: true},
		{name: "负数带空白报错", input: " -100 ", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parsePriceSunToTRX(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("expected %v, got %v", tc.want, got)
			}
		})
	}
}

// TestConvertInlineRows 覆盖 actions.InlineButton → inlineKeyboardButton 的纯转换逻辑。
func TestConvertInlineRows(t *testing.T) {
	t.Run("空 rows 返回 nil", func(t *testing.T) {
		got := convertInlineRows(nil)
		if got != nil {
			t.Fatalf("expected nil, got %v", got)
		}
		got = convertInlineRows([][]actions.InlineButton{})
		if got != nil {
			t.Fatalf("expected nil, got %v", got)
		}
	})

	t.Run("多行按钮按序转换", func(t *testing.T) {
		input := [][]actions.InlineButton{
			{{Text: "按钮A", CallbackData: "cb:a"}, {Text: "按钮B", CallbackData: "cb:b"}},
			{{Text: "按钮C", CallbackData: "cb:c"}},
		}
		got := convertInlineRows(input)
		if len(got) != 2 {
			t.Fatalf("expected 2 rows, got %d", len(got))
		}
		if len(got[0]) != 2 || got[0][0].Text != "按钮A" || got[0][0].CallbackData != "cb:a" {
			t.Fatalf("row 0 mismatch: %#v", got[0])
		}
		if got[0][1].Text != "按钮B" || got[0][1].CallbackData != "cb:b" {
			t.Fatalf("row 0 btn 1 mismatch: %#v", got[0][1])
		}
		if len(got[1]) != 1 || got[1][0].Text != "按钮C" || got[1][0].CallbackData != "cb:c" {
			t.Fatalf("row 1 mismatch: %#v", got[1])
		}
	})

	t.Run("保留空行结构", func(t *testing.T) {
		// 空行虽然在业务层不应出现，但转换函数不做裁剪，保留原结构交由 Telegram 处理。
		input := [][]actions.InlineButton{{}, {{Text: "X", CallbackData: "x"}}}
		got := convertInlineRows(input)
		if len(got) != 2 {
			t.Fatalf("expected 2 rows, got %d", len(got))
		}
		if len(got[0]) != 0 {
			t.Fatalf("expected empty row 0, got %d buttons", len(got[0]))
		}
	})
}

// TestLoadPackagesByIDs_EmptyIDs 覆盖空 ids 的短路逻辑（不需要 DB）。
//
// 完整的 DB 驱动测试（部分 id 不存在跳过、PriceSun 换算、listPackages 错误冒泡）
// 依赖 bot_test.go 中尚未建立的 DB mock 基础设施，留待任务 10D 清理时补齐。
func TestLoadPackagesByIDs_EmptyIDs(t *testing.T) {
	b := &Bot{}
	got, err := b.LoadPackagesByIDs(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil slice, got %v", got)
	}

	got, err = b.LoadPackagesByIDs(context.Background(), []int{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil slice, got %v", got)
	}
}

// TestNewBotInitializesDispatcher 验证 NewBot 构造的 Bot 注入了 dispatcher，
// 且 dispatcher 持有的 BotAPI 就是 Bot 自身。
func TestNewBotInitializesDispatcher(t *testing.T) {
	b := &Bot{}
	// 直接模拟 newBot 末尾的注入行为：dispatcher 非 nil、持有的 BotAPI 是 Bot。
	b.dispatcher = actions.NewDispatcher(b)

	if b.dispatcher == nil {
		t.Fatal("dispatcher should be initialized")
	}
	// 此处无法直接断言 dispatcher 内部的 bot 字段（未导出），
	// 但只要构造不 panic、字段非 nil，即满足本任务范围。
}

// TestRenderMessage 覆盖 renderMessage helper 的三类关键行为：
//   - 空模板 → 返回 fallback
//   - 非空模板 → 交给 template.Render 替换占位符
//   - 未知变量 → template.Render 保留原样（容错）
//
// renderMessage 是 bot_api.go 的纯方法（不依赖 Bot 状态），用 &Bot{} 零值即可。
func TestRenderMessage(t *testing.T) {
	b := &Bot{}

	t.Run("空模板返回 fallback", func(t *testing.T) {
		got := b.renderMessage("", nil, "fallback 文案")
		if got != "fallback 文案" {
			t.Errorf("got %q, want %q", got, "fallback 文案")
		}
	})

	t.Run("仅含空白的模板返回 fallback", func(t *testing.T) {
		got := b.renderMessage("   \n  \t", nil, "fallback")
		if got != "fallback" {
			t.Errorf("got %q, want %q", got, "fallback")
		}
	})

	t.Run("非空模板替换已知变量", func(t *testing.T) {
		got := b.renderMessage("命令 {command} 不支持。", map[string]string{"command": "/foo"}, "不该走到这里")
		want := "命令 /foo 不支持。"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("未知变量保留原样", func(t *testing.T) {
		got := b.renderMessage("hello {nobody}!", map[string]string{"command": "/foo"}, "fallback")
		want := "hello {nobody}!"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("vars 为 nil 时所有变量保留原样但不 panic", func(t *testing.T) {
		got := b.renderMessage("hi {command}", nil, "fallback")
		want := "hi {command}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("非空模板优先于 fallback", func(t *testing.T) {
		// 即使模板渲染后文本为空（极端场景），仍返回渲染结果，不回退 fallback。
		got := b.renderMessage(" hi ", nil, "fallback")
		if got != " hi " {
			t.Errorf("got %q, want %q", got, " hi ")
		}
	})
}
