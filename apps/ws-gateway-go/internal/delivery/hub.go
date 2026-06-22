// Package delivery is the gateway's outbound half (messaging spec §2.3): for
// every user holding at least one local connection it subscribes to that user's
// per-user Redis channel `user:{id}` and fans incoming frames out to all of
// their local sockets, unsubscribing when the last one disconnects. The gateway
// is a dumb relay — it forwards the JSON payload verbatim, understanding nothing
// about messages, acks or receipts. Routing is a Redis lookup, so a client may
// land on any gateway (no sticky sessions, REQUIREMENTS §8.2).
package delivery

import (
	"context"
	"log"
	"sync"

	"github.com/redis/go-redis/v9"
)

// userChannel mirrors the `user:{id}` convention chat-service / social-service
// publish to (@hsc/platform `userChannel`).
func userChannel(userID string) string { return "user:" + userID }

// Conn is a single local socket the hub can push raw frames to. Implemented by
// the ws connection; kept minimal so this package never imports ws (no cycle).
type Conn interface {
	// Enqueue hands a frame to the connection's writer. Best-effort and
	// non-blocking: a slow/dead consumer must not stall fan-out to siblings.
	Enqueue(frame []byte)
}

// Hub multiplexes per-user Redis subscriptions over local connections.
type Hub struct {
	rdb    *redis.Client
	mu     sync.Mutex
	groups map[string]*group
}

// group is the set of a user's local connections plus the single Redis
// subscription feeding them.
type group struct {
	conns  map[Conn]struct{}
	pubsub *redis.PubSub
	cancel context.CancelFunc
}

// NewHub builds an empty hub over the given Redis client.
func NewHub(rdb *redis.Client) *Hub {
	return &Hub{rdb: rdb, groups: make(map[string]*group)}
}

// Register adds a connection for userID, subscribing to their channel on the
// first connection (spec §2.3: subscribe per held connection, once per user).
func (h *Hub) Register(userID string, c Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	g, ok := h.groups[userID]
	if !ok {
		g = h.subscribe(userID)
		h.groups[userID] = g
	}
	g.conns[c] = struct{}{}
}

// Unregister drops a connection, tearing down the subscription on the user's
// last local disconnect (spec §2.3).
func (h *Hub) Unregister(userID string, c Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	g, ok := h.groups[userID]
	if !ok {
		return
	}
	delete(g.conns, c)
	if len(g.conns) == 0 {
		g.cancel()
		_ = g.pubsub.Close()
		delete(h.groups, userID)
	}
}

// subscribe opens the Redis subscription and starts its pump. Caller holds h.mu.
func (h *Hub) subscribe(userID string) *group {
	ctx, cancel := context.WithCancel(context.Background())
	pubsub := h.rdb.Subscribe(ctx, userChannel(userID))
	g := &group{conns: make(map[Conn]struct{}), pubsub: pubsub, cancel: cancel}
	go h.pump(ctx, userID, pubsub)
	return g
}

// pump forwards every message on the user's channel to their local sockets until
// the subscription is cancelled (last disconnect).
func (h *Hub) pump(ctx context.Context, userID string, pubsub *redis.PubSub) {
	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			h.fanout(userID, []byte(msg.Payload))
		}
	}
}

// fanout copies the current connection set under lock, then enqueues outside the
// lock so a slow socket can't block siblings or the Redis pump.
func (h *Hub) fanout(userID string, frame []byte) {
	h.mu.Lock()
	g, ok := h.groups[userID]
	if !ok {
		h.mu.Unlock()
		return
	}
	conns := make([]Conn, 0, len(g.conns))
	for c := range g.conns {
		conns = append(conns, c)
	}
	h.mu.Unlock()

	for _, c := range conns {
		c.Enqueue(frame)
	}
}

// Close tears down every active subscription (graceful shutdown).
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for userID, g := range h.groups {
		g.cancel()
		if err := g.pubsub.Close(); err != nil {
			log.Printf("delivery: closing subscription for %s: %v", userID, err)
		}
		delete(h.groups, userID)
	}
}
