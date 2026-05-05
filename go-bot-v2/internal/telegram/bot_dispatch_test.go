package telegram

import (
	"testing"

	"github.com/anomalyco/energybot-bot/internal/telegram/actions"
)

// TestBuildButtonSpec 覆盖 DesignerMenuButton → actions.ButtonSpec 的字段映射。
// 三个子测试分别对应：基本字段透传、Submenu 递归映射、PackageGroup 映射。
func TestBuildButtonSpec(t *testing.T) {
	t.Run("基本字段映射", func(t *testing.T) {
		btn := DesignerMenuButton{
			Text:    "购买",
			Action:  ActionURL,
			URL:     "https://example.com",
			Message: "hi",
			Command: "/start",
		}
		spec := buildButtonSpec(btn, "row0.btn1")

		if spec.Action != actions.ActionURL {
			t.Errorf("Action: expected %q, got %q", actions.ActionURL, spec.Action)
		}
		if spec.Text != "购买" {
			t.Errorf("Text: expected %q, got %q", "购买", spec.Text)
		}
		if spec.URL != "https://example.com" {
			t.Errorf("URL: expected %q, got %q", "https://example.com", spec.URL)
		}
		if spec.Message != "hi" {
			t.Errorf("Message: expected %q, got %q", "hi", spec.Message)
		}
		if spec.Command != "/start" {
			t.Errorf("Command: expected %q, got %q", "/start", spec.Command)
		}
		if spec.Path != "row0.btn1" {
			t.Errorf("Path: expected %q, got %q", "row0.btn1", spec.Path)
		}
		if spec.Submenu != nil {
			t.Errorf("Submenu 应为 nil, got %v", spec.Submenu)
		}
		if spec.PackageGroup != nil {
			t.Errorf("PackageGroup 应为 nil, got %v", spec.PackageGroup)
		}
	})

	t.Run("submenu 递归映射", func(t *testing.T) {
		btn := DesignerMenuButton{
			Text:   "更多",
			Action: ActionSubmenu,
			Submenu: []DesignerMenuRow{
				{Buttons: []DesignerMenuButton{
					{Text: "子1", Action: ActionText, Message: "m1"},
					{Text: "子2", Action: ActionURL, URL: "https://sub"},
				}},
				{Buttons: []DesignerMenuButton{
					{Text: "子3", Action: ActionText, Message: "m3"},
				}},
			},
		}
		spec := buildButtonSpec(btn, "row0.btn0")

		if spec.Action != actions.ActionSubmenu {
			t.Fatalf("Action: expected submenu, got %q", spec.Action)
		}
		if spec.Path != "row0.btn0" {
			t.Errorf("父按钮 Path: expected %q, got %q", "row0.btn0", spec.Path)
		}
		if len(spec.Submenu) != 2 {
			t.Fatalf("Submenu rows: expected 2, got %d", len(spec.Submenu))
		}
		if len(spec.Submenu[0].Buttons) != 2 {
			t.Fatalf("row 0 buttons: expected 2, got %d", len(spec.Submenu[0].Buttons))
		}
		if len(spec.Submenu[1].Buttons) != 1 {
			t.Fatalf("row 1 buttons: expected 1, got %d", len(spec.Submenu[1].Buttons))
		}
		// 子按钮字段透传正确
		child0 := spec.Submenu[0].Buttons[0]
		if child0.Text != "子1" || child0.Message != "m1" || child0.Action != actions.ActionText {
			t.Errorf("子1 字段异常: %+v", child0)
		}
		// 子按钮 Path 留空（由 handleSubmenu 内部根据父 Path 动态计算）
		if child0.Path != "" {
			t.Errorf("子按钮 Path 应为空, got %q", child0.Path)
		}
		if spec.Submenu[0].Buttons[1].Path != "" {
			t.Errorf("子按钮 Path 应为空, got %q", spec.Submenu[0].Buttons[1].Path)
		}
		if spec.Submenu[1].Buttons[0].Path != "" {
			t.Errorf("子按钮 Path 应为空, got %q", spec.Submenu[1].Buttons[0].Path)
		}
	})

	t.Run("packageGroup 映射", func(t *testing.T) {
		btn := DesignerMenuButton{
			Text:   "套餐组",
			Action: ActionEnergyPackageGroup,
			PackageGroup: &PackageGroupConfig{
				PackageIDs:   []int{1, 2, 3},
				TextTemplate: "{name} - {price}",
				SortBy:       "price_asc",
			},
		}
		spec := buildButtonSpec(btn, "row1.btn0")

		if spec.PackageGroup == nil {
			t.Fatal("PackageGroup 丢失")
		}
		if len(spec.PackageGroup.PackageIDs) != 3 {
			t.Errorf("PackageIDs: expected 3 elements, got %d", len(spec.PackageGroup.PackageIDs))
		}
		if spec.PackageGroup.PackageIDs[0] != 1 || spec.PackageGroup.PackageIDs[2] != 3 {
			t.Errorf("PackageIDs 内容异常: %v", spec.PackageGroup.PackageIDs)
		}
		if spec.PackageGroup.TextTemplate != "{name} - {price}" {
			t.Errorf("TextTemplate: expected %q, got %q", "{name} - {price}", spec.PackageGroup.TextTemplate)
		}
		if spec.PackageGroup.SortBy != "price_asc" {
			t.Errorf("SortBy: expected %q, got %q", "price_asc", spec.PackageGroup.SortBy)
		}
	})
}

// TestFindButtonReturnsPath 覆盖 findButton 新增的 path 返回值行为。
func TestFindButtonReturnsPath(t *testing.T) {
	t.Run("根层按钮路径", func(t *testing.T) {
		cfg := BotDesignerConfig{
			MenuRows: []DesignerMenuRow{
				{Buttons: []DesignerMenuButton{
					{Text: "A", Action: ActionText, Message: "a"},
					{Text: "B", Action: ActionText, Message: "b"},
				}},
				{Buttons: []DesignerMenuButton{
					{Text: "C", Action: ActionText, Message: "c"},
				}},
			},
		}

		_, path, ok := cfg.findButton("B", nil)
		if !ok {
			t.Fatal("应找到 B")
		}
		if path != "row0.btn1" {
			t.Errorf("B path: expected %q, got %q", "row0.btn1", path)
		}

		_, path, ok = cfg.findButton("C", nil)
		if !ok {
			t.Fatal("应找到 C")
		}
		if path != "row1.btn0" {
			t.Errorf("C path: expected %q, got %q", "row1.btn0", path)
		}

		_, path, ok = cfg.findButton("A", nil)
		if !ok {
			t.Fatal("应找到 A")
		}
		if path != "row0.btn0" {
			t.Errorf("A path: expected %q, got %q", "row0.btn0", path)
		}
	})

	t.Run("找不到按钮返回空 path + false", func(t *testing.T) {
		cfg := BotDesignerConfig{
			MenuRows: []DesignerMenuRow{
				{Buttons: []DesignerMenuButton{
					{Text: "A", Action: ActionText},
				}},
			},
		}
		_, path, ok := cfg.findButton("X", nil)
		if ok {
			t.Fatal("不应找到 X")
		}
		if path != "" {
			t.Errorf("未找到时 path 应为空, got %q", path)
		}
	})

	t.Run("空配置", func(t *testing.T) {
		_, path, ok := (BotDesignerConfig{}).findButton("X", nil)
		if ok {
			t.Fatal("空配置不应找到任何按钮")
		}
		if path != "" {
			t.Errorf("path 应为空, got %q", path)
		}
	})
}
