package template

import (
	"testing"
)

func TestRender_BasicSubstitution(t *testing.T) {
	t.Run("单变量替换", func(t *testing.T) {
		got := Render("Hello {name}!", map[string]string{"name": "World"})
		want := "Hello World!"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("多变量替换", func(t *testing.T) {
		got := Render("{a}-{b}", map[string]string{"a": "1", "b": "2"})
		want := "1-2"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("相同变量多次出现全部替换", func(t *testing.T) {
		got := Render("{a}-{a}-{a}", map[string]string{"a": "X"})
		want := "X-X-X"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("空模板返回空串", func(t *testing.T) {
		got := Render("", map[string]string{"name": "X"})
		if got != "" {
			t.Errorf("got %q, want empty string", got)
		}
	})

	t.Run("无占位符原样返回", func(t *testing.T) {
		got := Render("hello world", map[string]string{"name": "X"})
		want := "hello world"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("nil 变量 map 不 panic", func(t *testing.T) {
		got := Render("hello {name}", nil)
		want := "hello {name}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("中文 UTF-8 模板", func(t *testing.T) {
		got := Render("订单号：{orderNo} 已创建", map[string]string{"orderNo": "ORD-2026-001"})
		want := "订单号：ORD-2026-001 已创建"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("中文变量值", func(t *testing.T) {
		got := Render("用户：{name}，状态：{status}", map[string]string{
			"name":   "张三",
			"status": "已付款",
		})
		want := "用户：张三，状态：已付款"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
}

func TestRender_UnknownVariable(t *testing.T) {
	t.Run("单个未知变量保留原样", func(t *testing.T) {
		got := Render("{unknown}", map[string]string{})
		want := "{unknown}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("已知与未知混合", func(t *testing.T) {
		got := Render("{name}-{unknown}", map[string]string{"name": "a"})
		want := "a-{unknown}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
}

func TestRender_Escape(t *testing.T) {
	t.Run("双左括号转义为字面左括号", func(t *testing.T) {
		got := Render("{{", nil)
		want := "{"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("双右括号转义为字面右括号", func(t *testing.T) {
		got := Render("}}", nil)
		want := "}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("双括号包裹的变量名是字面", func(t *testing.T) {
		got := Render("{{name}}", map[string]string{"name": "X"})
		want := "{name}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("空双括号", func(t *testing.T) {
		got := Render("{{}}", nil)
		want := "{}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("三层嵌套：外层转义内层占位符", func(t *testing.T) {
		got := Render("值为 {{{name}}}", map[string]string{"name": "X"})
		want := "值为 {X}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("连续四个左括号转义为两个字面", func(t *testing.T) {
		got := Render("{{{{", nil)
		want := "{{"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("转义与替换混合", func(t *testing.T) {
		got := Render("{{raw}} and {name}", map[string]string{"name": "V", "raw": "R"})
		want := "{raw} and V"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
}

func TestRender_Boundary(t *testing.T) {
	t.Run("孤立左括号保留", func(t *testing.T) {
		got := Render("hello {", nil)
		want := "hello {"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("孤立右括号保留", func(t *testing.T) {
		got := Render("hello }", nil)
		want := "hello }"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("空占位符不替换", func(t *testing.T) {
		got := Render("{}", map[string]string{"": "X"})
		want := "{}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("非法标识符含点保留", func(t *testing.T) {
		got := Render("{a.b}", map[string]string{"a.b": "X"})
		want := "{a.b}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("非法标识符含连字符保留", func(t *testing.T) {
		got := Render("{a-b}", map[string]string{"a-b": "X"})
		want := "{a-b}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("非法标识符含空格保留", func(t *testing.T) {
		got := Render("{a b}", map[string]string{"a b": "X"})
		want := "{a b}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("数字开头标识符保留", func(t *testing.T) {
		got := Render("{1foo}", map[string]string{"1foo": "X"})
		want := "{1foo}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("下划线开头合法", func(t *testing.T) {
		got := Render("{_foo}", map[string]string{"_foo": "X"})
		want := "X"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("数字中间合法", func(t *testing.T) {
		got := Render("{foo1}", map[string]string{"foo1": "X"})
		want := "X"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("未闭合的左括号保留", func(t *testing.T) {
		got := Render("{name", map[string]string{"name": "X"})
		want := "{name"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("转义后跟孤立右括号", func(t *testing.T) {
		// {{ -> 字面 {，随后 a} 是孤立右括号（没有对应的占位符起点）
		got := Render("{{a}", nil)
		want := "{a}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
}

func TestRender_NoRecursion(t *testing.T) {
	t.Run("变量值含占位符不递归替换", func(t *testing.T) {
		got := Render("{a}", map[string]string{
			"a": "{b}",
			"b": "X",
		})
		want := "{b}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("变量值含双括号转义字符也不二次处理", func(t *testing.T) {
		got := Render("{a}", map[string]string{"a": "{{literal}}"})
		want := "{{literal}}"
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
}

func TestIsKnownVariable(t *testing.T) {
	t.Run("白名单内返回 true", func(t *testing.T) {
		for _, name := range []string{
			"orderNo", "packageName", "amount", "energy", "address",
			"payAddress", "txHash", "botName", "bandwidth", "balance", "reason",
			"command",
		} {
			if !IsKnownVariable(name) {
				t.Errorf("IsKnownVariable(%q) = false, want true", name)
			}
		}
	})

	t.Run("白名单外返回 false", func(t *testing.T) {
		for _, name := range []string{"xxx", "", "ORDERNO", "order_no", "unknown"} {
			if IsKnownVariable(name) {
				t.Errorf("IsKnownVariable(%q) = true, want false", name)
			}
		}
	})
}

func TestKnownVariables(t *testing.T) {
	t.Run("白名单长度为 12", func(t *testing.T) {
		if len(KnownVariables) != 12 {
			t.Errorf("len(KnownVariables) = %d, want 12", len(KnownVariables))
		}
	})

	t.Run("白名单内容匹配规格", func(t *testing.T) {
		want := []string{
			"orderNo", "packageName", "amount", "energy", "address",
			"payAddress", "txHash", "botName", "bandwidth", "balance", "reason",
			"command",
		}
		if len(KnownVariables) != len(want) {
			t.Fatalf("长度不匹配：got %d, want %d", len(KnownVariables), len(want))
		}
		for i, name := range want {
			if KnownVariables[i] != name {
				t.Errorf("KnownVariables[%d] = %q, want %q", i, KnownVariables[i], name)
			}
		}
	})
}
