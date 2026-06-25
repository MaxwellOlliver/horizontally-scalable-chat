package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	testSecret = "test-secret-test-secret-test-secret-123"
	testIssuer = "hsc-auth-test"
)

func mint(t *testing.T, method jwt.SigningMethod, key any, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(method, claims)
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func validClaims(sub string, ttl time.Duration) jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{
		"sub": sub,
		"iss": testIssuer,
		"iat": now.Unix(),
		"exp": now.Add(ttl).Unix(),
		"jti": "test-jti",
	}
}

func TestVerifyValidToken(t *testing.T) {
	v := NewVerifier(testSecret, testIssuer)
	token := mint(t, jwt.SigningMethodHS256, []byte(testSecret), validClaims("user-123", time.Minute))

	claims, err := v.Verify(token)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Fatalf("UserID = %q, want user-123", claims.UserID)
	}
}

func TestVerifyRejects(t *testing.T) {
	v := NewVerifier(testSecret, testIssuer)

	cases := map[string]string{
		"empty":        "",
		"garbage":      "not.a.jwt",
		"expired":      mint(t, jwt.SigningMethodHS256, []byte(testSecret), validClaims("u", -time.Minute)),
		"wrong secret": mint(t, jwt.SigningMethodHS256, []byte("another-secret-another-secret-xxxx"), validClaims("u", time.Minute)),
		"wrong issuer": mint(t, jwt.SigningMethodHS256, []byte(testSecret), jwt.MapClaims{"sub": "u", "iss": "someone-else", "exp": time.Now().Add(time.Minute).Unix()}),
		"missing sub":  mint(t, jwt.SigningMethodHS256, []byte(testSecret), jwt.MapClaims{"iss": testIssuer, "exp": time.Now().Add(time.Minute).Unix()}),
		"missing exp":  mint(t, jwt.SigningMethodHS256, []byte(testSecret), jwt.MapClaims{"sub": "u", "iss": testIssuer}),
		"alg none":     mint(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, validClaims("u", time.Minute)),
	}

	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := v.Verify(token); err == nil {
				t.Fatalf("expected rejection for %q, got nil error", name)
			}
		})
	}
}
