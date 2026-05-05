package telegram

import (
	"encoding/json"
	"testing"
)

func TestParseMenuRows_ValidNested(t *testing.T) {
	raw := `[{"id":"row1","buttons":[{"id":"btn1","text":"购买","action":"submenu","submenu":[{"id":"sub1","buttons":[{"id":"b","text":"套餐A","action":"energy_package_group","packageGroup":{"packageIds":[1,2],"sortBy":"price_asc","textTemplate":"{name}"}}]}]}]}]`
	rows, err := parseMenuRowsV2(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 || len(rows[0].Buttons) != 1 {
		t.Fatalf("expected 1 row with 1 button, got %+v", rows)
	}
	btn := rows[0].Buttons[0]
	if btn.Action != ActionSubmenu {
		t.Errorf("expected submenu action, got %s", btn.Action)
	}
	if len(btn.Submenu) != 1 {
		t.Errorf("expected 1 submenu row")
	}
	subBtn := btn.Submenu[0].Buttons[0]
	if subBtn.Action != ActionEnergyPackageGroup {
		t.Errorf("expected energy_package_group, got %s", subBtn.Action)
	}
	if subBtn.PackageGroup == nil || subBtn.PackageGroup.SortBy != "price_asc" {
		t.Errorf("packageGroup parsing failed: %+v", subBtn.PackageGroup)
	}
}

func TestParseMenuRows_InvalidAction(t *testing.T) {
	raw := `[{"id":"r","buttons":[{"id":"b","text":"x","action":"unknown_xyz"}]}]`
	_, err := parseMenuRowsV2(raw)
	if err == nil {
		t.Fatal("expected error for unknown action")
	}
}

func TestParseMenuRows_EmptyString(t *testing.T) {
	rows, err := parseMenuRowsV2("")
	if err != nil {
		t.Fatalf("empty string should not error: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("expected empty rows")
	}
}

func TestParseMenuRows_NullLiteral(t *testing.T) {
	rows, err := parseMenuRowsV2("null")
	if err != nil {
		t.Fatalf("null literal should not error: %v", err)
	}
	if rows != nil {
		t.Errorf("expected nil rows for null literal, got %+v", rows)
	}
}

func TestParseMenuRows_MalformedJSON(t *testing.T) {
	_, err := parseMenuRowsV2(`[{"id":"r","buttons":[`) // 截断
	if err == nil {
		t.Fatal("expected error for malformed JSON")
	}
}

func TestParseMenuRows_DepthExceeded(t *testing.T) {
	// 构造 4 层嵌套 submenu，应被深度校验拒绝（最大深度 3）
	raw := `[{"id":"r1","buttons":[{"id":"b1","text":"l1","action":"submenu","submenu":` +
		`[{"id":"r2","buttons":[{"id":"b2","text":"l2","action":"submenu","submenu":` +
		`[{"id":"r3","buttons":[{"id":"b3","text":"l3","action":"submenu","submenu":` +
		`[{"id":"r4","buttons":[{"id":"b4","text":"l4","action":"url","url":"https://x"}]}]}]}]}]}]}]`
	_, err := parseMenuRowsV2(raw)
	if err == nil {
		t.Fatal("expected depth-exceeded error for 4-level nested menu")
	}
}

func TestParseMessageTemplates(t *testing.T) {
	raw := `{"welcome":"欢迎","orderCreated":"订单 {orderNo}","paySuccess":"成功"}`
	cfg, err := parseMessageTemplates(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Welcome != "欢迎" || cfg.OrderCreated != "订单 {orderNo}" {
		t.Errorf("unexpected cfg: %+v", cfg)
	}
}

func TestParseMessageTemplates_MalformedJSON(t *testing.T) {
	_, err := parseMessageTemplates(`{invalid`)
	if err == nil {
		t.Fatal("expected error for malformed JSON in message templates")
	}
}

func TestParseMessageTemplates_Empty(t *testing.T) {
	cfg, err := parseMessageTemplates("")
	if err != nil {
		t.Fatalf("empty string should not error: %v", err)
	}
	if cfg != (MessageTemplates{}) {
		t.Errorf("expected zero-value templates, got %+v", cfg)
	}
}

func TestMarshalRoundtrip(t *testing.T) {
	original := []DesignerMenuRow{
		{
			ID: "row1",
			Buttons: []DesignerMenuButton{
				{
					ID:     "btn1",
					Text:   "外链",
					Action: ActionURL,
					URL:    "https://example.com",
				},
			},
		},
	}
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	parsed, err := parseMenuRowsV2(string(raw))
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if parsed[0].Buttons[0].URL != "https://example.com" {
		t.Errorf("URL field lost: %+v", parsed)
	}
}

// TestResolveMenuPath 覆盖路径定位的 5 个分支：根层命中、二级命中、越界、格式错、空路径。
func TestResolveMenuPath(t *testing.T) {
	rows := []DesignerMenuRow{
		{Buttons: []DesignerMenuButton{
			{Text: "A", Action: ActionText, Message: "ma"},
			{Text: "B", Action: ActionSubmenu, Submenu: []DesignerMenuRow{
				{Buttons: []DesignerMenuButton{
					{Text: "B1", Action: ActionText, Message: "mb1"},
					{Text: "B2", Action: ActionText, Message: "mb2"},
				}},
			}},
		}},
		{Buttons: []DesignerMenuButton{
			{Text: "C", Action: ActionURL, URL: "https://c"},
		}},
	}

	t.Run("根层按钮命中", func(t *testing.T) {
		btn, ok := resolveMenuPath(rows, "row0.btn0")
		if !ok {
			t.Fatal("want ok=true")
		}
		if btn.Text != "A" {
			t.Errorf("got text %q, want %q", btn.Text, "A")
		}
	})

	t.Run("二级子按钮命中", func(t *testing.T) {
		btn, ok := resolveMenuPath(rows, "row0.btn1.row0.btn1")
		if !ok {
			t.Fatal("want ok=true")
		}
		if btn.Text != "B2" {
			t.Errorf("got text %q, want %q", btn.Text, "B2")
		}
	})

	t.Run("第二行根层按钮", func(t *testing.T) {
		btn, ok := resolveMenuPath(rows, "row1.btn0")
		if !ok {
			t.Fatal("want ok=true")
		}
		if btn.Text != "C" {
			t.Errorf("got text %q, want %q", btn.Text, "C")
		}
	})

	t.Run("行越界返回 false", func(t *testing.T) {
		_, ok := resolveMenuPath(rows, "row9.btn0")
		if ok {
			t.Error("want ok=false")
		}
	})

	t.Run("按钮越界返回 false", func(t *testing.T) {
		_, ok := resolveMenuPath(rows, "row0.btn9")
		if ok {
			t.Error("want ok=false")
		}
	})

	t.Run("二级路径在无 submenu 的按钮上", func(t *testing.T) {
		// A 没有 submenu，深入 row0.btn0.rowX.btnY 必定越界
		_, ok := resolveMenuPath(rows, "row0.btn0.row0.btn0")
		if ok {
			t.Error("want ok=false（A 没有 submenu）")
		}
	})

	t.Run("格式错误：非 row/btn 前缀", func(t *testing.T) {
		_, ok := resolveMenuPath(rows, "xyz.abc")
		if ok {
			t.Error("want ok=false")
		}
	})

	t.Run("格式错误：段数为奇数", func(t *testing.T) {
		_, ok := resolveMenuPath(rows, "row0")
		if ok {
			t.Error("want ok=false")
		}
	})

	t.Run("格式错误：非数字索引", func(t *testing.T) {
		_, ok := resolveMenuPath(rows, "rowA.btn0")
		if ok {
			t.Error("want ok=false")
		}
	})

	t.Run("空 path", func(t *testing.T) {
		_, ok := resolveMenuPath(rows, "")
		if ok {
			t.Error("want ok=false")
		}
	})

	t.Run("空白 path", func(t *testing.T) {
		_, ok := resolveMenuPath(rows, "   ")
		if ok {
			t.Error("want ok=false")
		}
	})

	t.Run("nil rows + 非空 path", func(t *testing.T) {
		_, ok := resolveMenuPath(nil, "row0.btn0")
		if ok {
			t.Error("want ok=false")
		}
	})
}
