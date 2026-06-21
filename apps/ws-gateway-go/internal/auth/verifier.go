// Package auth verifies access-token JWTs locally, using only the shared secret
// and the documented claim contract — never calling the app tier (AC-W2).
package auth

import (
	"errors"

	"github.com/golang-jwt/jwt/v5"
)

// ErrInvalidToken is returned for any token that is missing, malformed, expired,
// wrongly-signed, or missing required claims. The caller maps it to close 4401
// (AC-W4) — we deliberately do not distinguish the failure reason to the client.
var ErrInvalidToken = errors.New("invalid access token")

// Claims is the minimal identity the gateway extracts from a verified token.
type Claims struct {
	// UserID is the JWT `sub` (a UUIDv7) — the connection's identity (AC-W5).
	UserID string
}

// Verifier validates HS256 access tokens against the shared secret + issuer.
type Verifier struct {
	secret []byte
	issuer string
}

// NewVerifier builds a Verifier. The secret must match the auth-service's
// JWT_SECRET (spec §2.8).
func NewVerifier(secret, issuer string) *Verifier {
	return &Verifier{secret: []byte(secret), issuer: issuer}
}

// Verify checks signature, algorithm, issuer, and expiry, then returns the
// identity claims. It enforces HS256 only (rejecting `alg: none` and algorithm
// confusion) and requires an `exp` claim.
func (v *Verifier) Verify(tokenString string) (*Claims, error) {
	if tokenString == "" {
		return nil, ErrInvalidToken
	}

	token, err := jwt.Parse(
		tokenString,
		func(t *jwt.Token) (interface{}, error) { return v.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer(v.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}
	sub, err := claims.GetSubject()
	if err != nil || sub == "" {
		return nil, ErrInvalidToken
	}

	return &Claims{UserID: sub}, nil
}
