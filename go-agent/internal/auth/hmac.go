// Package auth 实现 energybot agent 与 nest-api 之间的 HMAC-SHA256 请求签名，
// 严格对齐 nest-api/src/common/crypto/hmac.util.ts 的规范串格式与签名算法。
//
// 规范串（5 段，LF 换行，无 trailing newline）：
//
//	METHOD\n
//	PATH\n
//	TIMESTAMP_MS\n
//	NONCE_HEX\n
//	SHA256_OF_BODY_HEX
//
// METHOD 固定大写，空 body 使用 EmptyBodySHA256 常量，输出 64 字符 lowercase hex。
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

// EmptyBodySHA256 是 sha256("") 的 lowercase hex 表示，对齐 Nest 的 EMPTY_BODY_SHA256。
// 当请求 body 为空时，规范串的 body hash 段使用此常量。
const EmptyBodySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// SignParams 是签名所需的全部参数。字段命名与 Nest 侧 signCanonicalRequest 的入参对齐。
//
// Body 使用 []byte 而非 string，因为网络层通常直接握着 wire bytes；
// 空 body 传 nil 或 []byte{} 均可，走 EmptyBodySHA256 分支。
type SignParams struct {
	Secret    string
	Method    string
	Path      string
	Timestamp string
	Nonce     string
	Body      []byte
}

// Sign 生成规范串并用 HMAC-SHA256(secret) 签名，返回 64 字符 lowercase hex。
func Sign(p SignParams) string {
	canonical := buildCanonical(p)
	mac := hmac.New(sha256.New, []byte(p.Secret))
	mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil))
}

// Verify 使用常量时间比较校验签名。长度不等直接返回 false，
// 避免 subtle.ConstantTimeCompare 在不等长切片下走到多余路径（行为上也和 Nest 侧一致）。
func Verify(p SignParams, signature string) bool {
	expected := Sign(p)
	if len(expected) != len(signature) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func buildCanonical(p SignParams) string {
	return strings.Join([]string{
		strings.ToUpper(p.Method),
		p.Path,
		p.Timestamp,
		p.Nonce,
		bodyHash(p.Body),
	}, "\n")
}

func bodyHash(body []byte) string {
	if len(body) == 0 {
		return EmptyBodySHA256
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}
