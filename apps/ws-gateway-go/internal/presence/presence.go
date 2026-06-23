// Package presence tracks per-user online status in Redis so it is visible
// across all gateway instances (REQUIREMENTS §5). Status is focus-driven: a live
// socket alone is not "online" (§5.1); the effective status is the most-present
// state across a user's connections (§5.2). TTLs refreshed by heartbeat make it
// self-healing when a connection or whole gateway dies (§5.3).
package presence

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// Status is a user's (or a single connection's) presence state.
type Status int

const (
	Offline Status = iota // no live connection
	Idle                  // connected but tab not focused
	Online                // connected and focused
)

func (s Status) String() string {
	switch s {
	case Online:
		return "online"
	case Idle:
		return "idle"
	default:
		return "offline"
	}
}

// connState reads a stored per-connection state. A live connection is at least
// Idle; we never persist Offline (absence == offline).
func connState(v string) Status {
	if v == "online" {
		return Online
	}
	return Idle
}

// Store is the presence persistence port (so the gateway can swap Redis for a
// fake in tests).
type Store interface {
	// Register records a new connection for a user with an initial focus state.
	Register(ctx context.Context, userID, connID string, st Status) error
	// Heartbeat refreshes a connection's TTL without changing its focus state.
	Heartbeat(ctx context.Context, userID, connID string) error
	// SetState updates a connection's focus state (and refreshes its TTL).
	SetState(ctx context.Context, userID, connID string, st Status) error
	// Remove deletes a connection (clean disconnect).
	Remove(ctx context.Context, userID, connID string) error
	// Effective returns the user's most-present status across live connections.
	Effective(ctx context.Context, userID string) (Status, error)
}

// RedisStore is the Redis-backed Store.
//
// Keys:
//   - presence:user:{userID}  ZSET  member=connID  score=expiry-unix-ms
//     (liveness + enumeration; score gives the per-member TTL a SET can't)
//   - presence:conn:{connID}  STRING  "online"|"idle"  with key TTL
type RedisStore struct {
	rdb redis.UniversalClient
	ttl time.Duration
	now func() time.Time // injectable for tests
}

// NewRedisStore builds a RedisStore. ttl is the presence lifetime between
// heartbeats (a missed heartbeat lets the connection expire to offline).
func NewRedisStore(rdb redis.UniversalClient, ttl time.Duration) *RedisStore {
	return &RedisStore{rdb: rdb, ttl: ttl, now: time.Now}
}

func userKey(userID string) string { return "presence:user:" + userID }
func connKey(connID string) string { return "presence:conn:" + connID }

// write sets liveness + focus state and (re)applies the TTL. Shared by
// Register and SetState.
func (s *RedisStore) write(ctx context.Context, userID, connID string, st Status) error {
	expiry := s.now().Add(s.ttl)
	pipe := s.rdb.TxPipeline()
	pipe.ZAdd(ctx, userKey(userID), redis.Z{Score: float64(expiry.UnixMilli()), Member: connID})
	pipe.PExpire(ctx, userKey(userID), s.ttl) // don't leak the user key
	pipe.Set(ctx, connKey(connID), st.String(), s.ttl)
	_, err := pipe.Exec(ctx)
	return err
}

func (s *RedisStore) Register(ctx context.Context, userID, connID string, st Status) error {
	if err := s.write(ctx, userID, connID, st); err != nil {
		return err
	}
	s.publishChange(ctx, userID)
	return nil
}

func (s *RedisStore) SetState(ctx context.Context, userID, connID string, st Status) error {
	if err := s.write(ctx, userID, connID, st); err != nil {
		return err
	}
	s.publishChange(ctx, userID)
	return nil
}

// Heartbeat refreshes TTLs and the liveness score without touching the stored
// focus state.
func (s *RedisStore) Heartbeat(ctx context.Context, userID, connID string) error {
	expiry := s.now().Add(s.ttl)
	pipe := s.rdb.TxPipeline()
	pipe.ZAdd(ctx, userKey(userID), redis.Z{Score: float64(expiry.UnixMilli()), Member: connID})
	pipe.PExpire(ctx, userKey(userID), s.ttl)
	pipe.PExpire(ctx, connKey(connID), s.ttl)
	_, err := pipe.Exec(ctx)
	return err
}

func (s *RedisStore) Remove(ctx context.Context, userID, connID string) error {
	pipe := s.rdb.TxPipeline()
	pipe.ZRem(ctx, userKey(userID), connID)
	pipe.Del(ctx, connKey(connID))
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}
	s.publishChange(ctx, userID)
	return nil
}

// presenceChannel is the per-user pub/sub channel a friend's gateway subscribes
// to (via the Feed) to watch that user's status. Distinct from the ZSET key.
func presenceChannel(userID string) string { return "presence-feed:" + userID }

type changeFrame struct {
	Type string     `json:"type"`
	Data changeData `json:"data"`
}

type changeData struct {
	UserID string `json:"userId"`
	Status string `json:"status"`
}

// changePayload is the `presence.changed` frame forwarded verbatim to watchers.
func changePayload(userID string, st Status) []byte {
	b, _ := json.Marshal(changeFrame{Type: "presence.changed", Data: changeData{UserID: userID, Status: st.String()}})
	return b
}

// publishChange recomputes the user's effective status and publishes it to their
// presence channel for any watching gateways to forward. Best-effort: a publish
// failure must not fail the presence mutation that triggered it.
func (s *RedisStore) publishChange(ctx context.Context, userID string) {
	st, err := s.Effective(ctx, userID)
	if err != nil {
		return
	}
	_ = s.rdb.Publish(ctx, presenceChannel(userID), changePayload(userID, st)).Err()
}

func (s *RedisStore) Effective(ctx context.Context, userID string) (Status, error) {
	nowMs := s.now().UnixMilli()

	// Prune connections whose TTL has lapsed (self-healing, §5.3).
	if err := s.rdb.ZRemRangeByScore(ctx, userKey(userID), "0", strconv.FormatInt(nowMs, 10)).Err(); err != nil {
		return Offline, err
	}

	members, err := s.rdb.ZRange(ctx, userKey(userID), 0, -1).Result()
	if err != nil {
		return Offline, err
	}
	if len(members) == 0 {
		return Offline, nil
	}

	keys := make([]string, len(members))
	for i, m := range members {
		keys[i] = connKey(m)
	}
	vals, err := s.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return Offline, err
	}

	// At least one live member exists, so the floor is Idle; promote to Online
	// if any focused connection is present (§5.2 precedence).
	result := Idle
	for _, v := range vals {
		s, ok := v.(string)
		if !ok {
			continue // state key gone but member still live -> counts as Idle
		}
		if st := connState(s); st > result {
			result = st
		}
	}
	return result, nil
}
