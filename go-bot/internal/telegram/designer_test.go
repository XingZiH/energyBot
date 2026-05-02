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

func TestParseMessageConfig_V2(t *testing.T) {
	raw := `{"welcome":"欢迎","orderCreated":"订单 {orderNo}","paySuccess":"成功"}`
	cfg, err := parseMessageTemplates(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Welcome != "欢迎" || cfg.OrderCreated != "订单 {orderNo}" {
		t.Errorf("unexpected cfg: %+v", cfg)
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
