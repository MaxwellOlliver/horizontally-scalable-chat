package presence

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

const ttl = 30 * time.Second

func newStore(t *testing.T) (*RedisStore, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return NewRedisStore(rdb, ttl), mr
}

func effective(t *testing.T, s *RedisStore, userID string) Status {
	t.Helper()
	st, err := s.Effective(context.Background(), userID)
	if err != nil {
		t.Fatalf("Effective: %v", err)
	}
	return st
}

// §5.1: a live socket alone is not "online" — a freshly registered connection
// defaults to Idle.
func TestRegisterDefaultsIdle(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	if err := s.Register(ctx, "u1", "c1", Idle); err != nil {
		t.Fatal(err)
	}
	if got := effective(t, s, "u1"); got != Idle {
		t.Fatalf("status = %v, want Idle", got)
	}
}

// Unknown user is Offline.
func TestUnknownUserOffline(t *testing.T) {
	s, _ := newStore(t)
	if got := effective(t, s, "nobody"); got != Offline {
		t.Fatalf("status = %v, want Offline", got)
	}
}

func TestFocusBlurTransitions(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	_ = s.Register(ctx, "u1", "c1", Idle)

	_ = s.SetState(ctx, "u1", "c1", Online)
	if got := effective(t, s, "u1"); got != Online {
		t.Fatalf("after focus: %v, want Online", got)
	}
	_ = s.SetState(ctx, "u1", "c1", Idle)
	if got := effective(t, s, "u1"); got != Idle {
		t.Fatalf("after blur: %v, want Idle", got)
	}
}

// §5.2: effective status is the most-present across all connections.
func TestMultiDevicePrecedence(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	_ = s.Register(ctx, "u1", "phone", Idle)
	_ = s.Register(ctx, "u1", "laptop", Online)

	if got := effective(t, s, "u1"); got != Online {
		t.Fatalf("one online device should make user Online, got %v", got)
	}

	// Laptop blurs; only idle phone remains -> Idle.
	_ = s.SetState(ctx, "u1", "laptop", Idle)
	if got := effective(t, s, "u1"); got != Idle {
		t.Fatalf("all idle -> Idle, got %v", got)
	}
}

func TestRemoveGoesOffline(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	_ = s.Register(ctx, "u1", "c1", Online)
	_ = s.Remove(ctx, "u1", "c1")
	if got := effective(t, s, "u1"); got != Offline {
		t.Fatalf("after remove: %v, want Offline", got)
	}
}

// §5.3: a missed heartbeat lets the connection expire to offline (self-healing).
func TestExpirySelfHeals(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	_ = s.Register(ctx, "u1", "c1", Online)

	// Advance our clock past the TTL: the ZSET prune in Effective drops the
	// stale connection without any explicit cleanup.
	s.now = func() time.Time { return time.Now().Add(ttl + time.Second) }
	if got := effective(t, s, "u1"); got != Offline {
		t.Fatalf("expired connection should be Offline, got %v", got)
	}
}

// Heartbeat keeps a connection alive and preserves its focus state.
func TestHeartbeatPreservesState(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	_ = s.Register(ctx, "u1", "c1", Online)
	if err := s.Heartbeat(ctx, "u1", "c1"); err != nil {
		t.Fatal(err)
	}
	if got := effective(t, s, "u1"); got != Online {
		t.Fatalf("heartbeat should preserve Online, got %v", got)
	}
}
