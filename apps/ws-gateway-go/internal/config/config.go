// Package config loads and validates the gateway's runtime configuration.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config is the validated gateway configuration. JWTSecret + JWTIssuer are a
// cross-language contract with the auth-service (spec §2.8): both must agree so
// the gateway can verify access tokens locally.
type Config struct {
	Port        string
	JWTSecret   string
	JWTIssuer   string
	AuthTimeout time.Duration
	// RedisURL backs cross-instance presence (REQUIREMENTS §5) and the outbound
	// per-user delivery channels (messaging spec §2.3).
	RedisURL string
	// PresenceTTL is the lifetime of a connection's presence between heartbeats.
	PresenceTTL time.Duration
	// RabbitMQURL is the broker the inbound client-message work queue lives on.
	RabbitMQURL string
	// InboundQueue is the durable work queue chat-service consumes (spec §2.2).
	InboundQueue string
}

// Load reads configuration from the environment, applying defaults and failing
// fast on anything missing or malformed.
func Load() (*Config, error) {
	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be set and at least 32 chars")
	}

	timeoutSeconds, err := positiveIntDefault("WS_AUTH_TIMEOUT_SECONDS", 5)
	if err != nil {
		return nil, err
	}
	presenceTTLSeconds, err := positiveIntDefault("PRESENCE_TTL_SECONDS", 30)
	if err != nil {
		return nil, err
	}

	return &Config{
		Port:         getenvDefault("PORT", "8080"),
		JWTSecret:    secret,
		JWTIssuer:    getenvDefault("JWT_ISSUER", "hsc-auth"),
		AuthTimeout:  time.Duration(timeoutSeconds) * time.Second,
		RedisURL:     getenvDefault("REDIS_URL", "redis://localhost:6379"),
		PresenceTTL:  time.Duration(presenceTTLSeconds) * time.Second,
		RabbitMQURL:  getenvDefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"),
		InboundQueue: getenvDefault("INBOUND_QUEUE", "chat.inbound"),
	}, nil
}

func positiveIntDefault(key string, fallback int) (int, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return parsed, nil
}

func getenvDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
