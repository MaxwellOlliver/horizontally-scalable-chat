// Command gateway is the WebSocket gateway: it authenticates connections at
// handshake by verifying access-token JWTs locally (spec §2.4), keeps them
// registered for routing, and maintains cross-instance presence in Redis
// (REQUIREMENTS §5). It never mints tokens or reads the users table.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/auth"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/config"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/delivery"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/inbound"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/presence"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/registry"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/ws"
)

func main() {
	// `ws-gateway-go -healthcheck` probes /health and exits 0/1. This is the
	// container HEALTHCHECK: the distroless image has no shell or curl, so the
	// binary health-checks itself.
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		runHealthcheck()
		return
	}

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

	// Outbound: fan per-user Redis frames out to local sockets (spec §2.3).
	deliveryHub := delivery.NewHub(rdb)
	defer deliveryHub.Close()
	// Inbound: stamp + publish client `message.send` to the work queue (spec §2.2).
	inboundPublisher := inbound.NewRabbitPublisher(cfg.RabbitMQURL, cfg.InboundQueue)
	defer func() { _ = inboundPublisher.Close() }()
	// Presence feed: forward watched friends' status to interested sockets (§5.4).
	presenceFeed := presence.NewFeed(rdb, presenceStore)
	defer presenceFeed.Close()

	handler := ws.NewHandler(verifier, reg, presenceStore, deliveryHub, inboundPublisher, presenceFeed, cfg.AuthTimeout)

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

// runHealthcheck GETs the local /health and exits non-zero on any failure, for
// the container HEALTHCHECK.
func runHealthcheck() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		os.Exit(1)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		os.Exit(1)
	}
}
