package auth

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type fixturePair struct {
	Secret    string `json:"secret"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Body      string `json:"body"`
	Timestamp string `json:"timestamp"`
	Nonce     string `json:"nonce"`
	Signature string `json:"signature"`
}

func loadFixtures(t *testing.T) []fixturePair {
	t.Helper()
	// 测试 CWD 是包目录 internal/auth/，fixture 在 go-agent/test/fixtures/
	path := filepath.Join("..", "..", "test", "fixtures", "hmac-pairs.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读 fixture 失败：%v（cwd 应在 internal/auth）", err)
	}
	var pairs []fixturePair
	if err := json.Unmarshal(data, &pairs); err != nil {
		t.Fatalf("解析 fixture 失败：%v", err)
	}
	if len(pairs) == 0 {
		t.Fatalf("fixture 为空")
	}
	return pairs
}

// TestSign_FixtureParity 跨端一致性：Go 实现对同一输入应产出与 Nest 端完全相同的签名。
func TestSign_FixtureParity(t *testing.T) {
	pairs := loadFixtures(t)
	for i, p := range pairs {
		p := p
		i := i
		t.Run(p.Method+"_"+p.Path, func(t *testing.T) {
			got := Sign(SignParams{
				Secret:    p.Secret,
				Method:    p.Method,
				Path:      p.Path,
				Timestamp: p.Timestamp,
				Nonce:     p.Nonce,
				Body:      []byte(p.Body),
			})
			if got != p.Signature {
				t.Errorf("fixture[%d] method=%s path=%s secret=%s ts=%s nonce=%s body=%q\n  want: %s\n   got: %s",
					i, p.Method, p.Path, p.Secret, p.Timestamp, p.Nonce, p.Body, p.Signature, got)
			}
		})
	}
}

// TestEmptyBodySHA256Constant 常量值对齐 Nest EMPTY_BODY_SHA256。
func TestEmptyBodySHA256Constant(t *testing.T) {
	const want = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if EmptyBodySHA256 != want {
		t.Errorf("EmptyBodySHA256 不匹配\n  want: %s\n   got: %s", want, EmptyBodySHA256)
	}
}

// TestVerify_Success 用 fixture 第一条产出的签名，Verify 应返回 true。
func TestVerify_Success(t *testing.T) {
	pairs := loadFixtures(t)
	p := pairs[0]
	params := SignParams{
		Secret:    p.Secret,
		Method:    p.Method,
		Path:      p.Path,
		Timestamp: p.Timestamp,
		Nonce:     p.Nonce,
		Body:      []byte(p.Body),
	}
	if !Verify(params, p.Signature) {
		t.Fatalf("Verify 对合法签名应返回 true，但返回 false")
	}
}

// TestVerify_Mismatch 签名改一字符应验证失败。
func TestVerify_Mismatch(t *testing.T) {
	pairs := loadFixtures(t)
	p := pairs[0]
	params := SignParams{
		Secret:    p.Secret,
		Method:    p.Method,
		Path:      p.Path,
		Timestamp: p.Timestamp,
		Nonce:     p.Nonce,
		Body:      []byte(p.Body),
	}
	// 翻转最后一个字符：原始 hex 末位如果是 '3' 改为 '4'，反之改为 '3'
	bad := []byte(p.Signature)
	if bad[len(bad)-1] == '3' {
		bad[len(bad)-1] = '4'
	} else {
		bad[len(bad)-1] = '3'
	}
	if Verify(params, string(bad)) {
		t.Fatalf("Verify 对篡改签名应返回 false，但返回 true")
	}
}

// TestVerify_LengthDiff 长度不等必须直接 false，不能 panic（防 subtle.ConstantTimeCompare 入参长度不一致的情况）。
func TestVerify_LengthDiff(t *testing.T) {
	params := SignParams{
		Secret:    "whatever",
		Method:    "GET",
		Path:      "/agent",
		Timestamp: "1714800000000",
		Nonce:     "00000000000000000000000000000000",
		Body:      nil,
	}
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Verify 对短签名不应 panic，但 panic: %v", r)
		}
	}()
	if Verify(params, "too-short") {
		t.Fatalf("Verify 对长度不等的签名应返回 false")
	}
}

// TestSign_MethodCaseInsensitive 对齐 Nest 的 method.toUpperCase()，"get" 与 "GET" 签名结果必须一致。
func TestSign_MethodCaseInsensitive(t *testing.T) {
	base := SignParams{
		Secret:    "test-secret",
		Path:      "/agent",
		Timestamp: "1714800000000",
		Nonce:     "00000000000000000000000000000000",
		Body:      nil,
	}
	a := base
	a.Method = "get"
	b := base
	b.Method = "GET"
	sigLower := Sign(a)
	sigUpper := Sign(b)
	if sigLower != sigUpper {
		t.Errorf("method 大小写应归一化\n  get : %s\n  GET : %s", sigLower, sigUpper)
	}
}
