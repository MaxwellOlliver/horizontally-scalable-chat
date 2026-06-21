// Command gateway is the WebSocket gateway: it authenticates connections at
// handshake by verifying access-token JWTs locally (spec §2.4), keeps them
// registered for routing, and maintains cross-instance presence in Redis
// (REQUIREMENTS §5). It never mints tokens or reads the users table.
package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/redis/go-redis/v9"

	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/auth"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/config"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/presence"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/registry"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/ws"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("invalid REDIS_URL: %v", err)
	}
	rdb := redis.NewClient(redisOpts)
	defer func() { _ = rdb.Close() }()

	verifier := auth.NewVerifier(cfg.JWTSecret, cfg.JWTIssuer)
	reg := registry.New()
	presenceStore := presence.NewRedisStore(rdb, cfg.PresenceTTL)
	handler := ws.NewHandler(verifier, reg, presenceStore, cfg.AuthTimeout)

	mux := http.NewServeMux()
	mux.Handle("/ws", handler)
	mux.HandleFunc("GET /presence/{userID}", presenceReadHandler(presenceStore))
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]string{"status": "ok", "service": "ws-gateway-go"})
	})

	addr := ":" + cfg.Port
	log.Printf("🔌 ws-gateway-go listening on %s (ws path /ws)", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// presenceReadHandler exposes a user's effective presence for observability and
// for the (future) friend-presence fan-out. Read-only.
func presenceReadHandler(store presence.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.PathValue("userID")
		status, err := store.Effective(r.Context(), userID)
		if err != nil {
			http.Error(w, "presence lookup failed", http.StatusBadGateway)
			return
		}
		writeJSON(w, map[string]string{"userId": userID, "status": status.String()})
	}
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}
