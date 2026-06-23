package ws

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"

	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/auth"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/delivery"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/inbound"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/presence"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/registry"
)

const (
	testSecret = "test-secret-test-secret-test-secret-123"
	testIssuer = "hsc-auth-test"
)

// testRig spins up the real handler behind an httptest server, backed by an
// in-process miniredis so presence assertions hit the real Redis store.
type testRig struct {
	server   *httptest.Server
	registry *registry.Registry
	presence *presence.RedisStore
	delivery *delivery.Hub
	inbound  *stubInbound
	rdb      *redis.Client
	url      string
}

// stubInbound captures published envelopes so tests can assert the gateway
// stamps the sender and publishes without standing up a real broker.
type stubInbound struct {
	mu        sync.Mutex
	published []inbound.Envelope
}

func (s *stubInbound) Publish(env inbound.Envelope) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.published = append(s.published, env)
	return nil
}

func (s *stubInbound) PublishReceipt(inbound.ReceiptEnvelope) error { return nil }

func (s *stubInbound) all() []inbound.Envelope {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]inbound.Envelope(nil), s.published...)
}

func newRig(t *testing.T, authTimeout time.Duration) *testRig {
	t.Helper()
	reg := registry.New()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	pres := presence.NewRedisStore(rdb, 30*time.Second)
	hub := delivery.NewHub(rdb)
	t.Cleanup(hub.Close)
	in := &stubInbound{}

	feed := presence.NewFeed(rdb, pres)
	h := NewHandler(auth.NewVerifier(testSecret, testIssuer), reg, pres, hub, in, feed, nil, authTimeout)
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &testRig{
		server:   srv,
		registry: reg,
		presence: pres,
		delivery: hub,
		inbound:  in,
		rdb:      rdb,
		url:      "ws" + strings.TrimPrefix(srv.URL, "http"),
	}
}

func (r *testRig) effective(t *testing.T, userID string) presence.Status {
	t.Helper()
	st, err := r.presence.Effective(context.Background(), userID)
	if err != nil {
		t.Fatalf("Effective: %v", err)
	}
	return st
}

// waitForStatus polls until the user's presence reaches want (presence updates
// happen asynchronously in the server's read loop).
func (r *testRig) waitForStatus(t *testing.T, userID string, want presence.Status) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if r.effective(t, userID) == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("presence for %s did not reach %v (last: %v)", userID, want, r.effective(t, userID))
}

func (r *testRig) dial(t *testing.T) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(r.url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func mintToken(t *testing.T, secret, sub string, ttl time.Duration) string {
	t.Helper()
	now := time.Now()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": sub,
		"iss": testIssuer,
		"iat": now.Unix(),
		"exp": now.Add(ttl).Unix(),
		"jti": "test-jti",
	})
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func sendAuth(t *testing.T, c *websocket.Conn, token string) {
	t.Helper()
	if err := c.WriteJSON(authFrame{Type: "auth", Token: token}); err != nil {
		t.Fatalf("write auth frame: %v", err)
	}
}

func readAuthOK(t *testing.T, c *websocket.Conn) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("expected auth_ok, got error: %v", err)
	}
	var f serverFrame
	if err := json.Unmarshal(data, &f); err != nil || f.Type != "auth_ok" {
		t.Fatalf("expected auth_ok frame, got %s", string(data))
	}
}

func expectClose(t *testing.T, c *websocket.Conn, wantCode int) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, err := c.ReadMessage()
	var ce *websocket.CloseError
	if !errors.As(err, &ce) {
		t.Fatalf("expected a close error, got: %v", err)
	}
	if ce.Code != wantCode {
		t.Fatalf("close code = %d, want %d", ce.Code, wantCode)
	}
}

// AC-W1/W2/W5: valid first-frame token -> auth_ok, and the user id becomes the
// connection identity in the registry. Registration happens only after verify.
func TestValidTokenAuthenticatesAndRegisters(t *testing.T) {
	rig := newRig(t, time.Second)
	c := rig.dial(t)

	if got := rig.registry.CountForUser("user-1"); got != 0 {
		t.Fatalf("registered before auth: count=%d (AC-W2 violation)", got)
	}

	sendAuth(t, c, mintToken(t, testSecret, "user-1", time.Minute))
	readAuthOK(t, c)

	if got := rig.registry.CountForUser("user-1"); got != 1 {
		t.Fatalf("registry count = %d, want 1 (AC-W5)", got)
	}
}

// AC-W4: a missing token closes with 4401 and does not register.
func TestMissingTokenCloses4401(t *testing.T) {
	rig := newRig(t, time.Second)
	c := rig.dial(t)
	sendAuth(t, c, "") // type=auth but empty token
	expectClose(t, c, closeUnauthorized)
	if got := rig.registry.CountForUser("user-1"); got != 0 {
		t.Fatalf("registered despite failed auth: count=%d", got)
	}
}

// AC-W4: a malformed first frame (not an auth frame) closes with 4401.
func TestMalformedFrameCloses4401(t *testing.T) {
	rig := newRig(t, time.Second)
	c := rig.dial(t)
	if err := c.WriteMessage(websocket.TextMessage, []byte("this is not json")); err != nil {
		t.Fatalf("write: %v", err)
	}
	expectClose(t, c, closeUnauthorized)
}

// AC-W4: an expired token closes with 4401.
func TestExpiredTokenCloses4401(t *testing.T) {
	rig := newRig(t, time.Second)
	c := rig.dial(t)
	sendAuth(t, c, mintToken(t, testSecret, "user-1", -time.Minute))
	expectClose(t, c, closeUnauthorized)
}

// AC-W4: a wrongly-signed token closes with 4401.
func TestBadSignatureCloses4401(t *testing.T) {
	rig := newRig(t, time.Second)
	c := rig.dial(t)
	sendAuth(t, c, mintToken(t, "a-different-secret-a-different-secret", "user-1", time.Minute))
	expectClose(t, c, closeUnauthorized)
}

// AC-W3: no auth frame within the auth timeout closes with 4408.
func TestAuthTimeoutCloses4408(t *testing.T) {
	rig := newRig(t, 150*time.Millisecond)
	c := rig.dial(t)
	// Send nothing; the gateway's auth timer should fire.
	expectClose(t, c, closeAuthTimeout)
}

// AC-C1: once authenticated, the connection persists past the auth timeout even
// though the token (here) outlives it — the gateway authenticates only at
// handshake and does not re-check the token mid-connection.
func TestConnectionPersistsAfterAuth(t *testing.T) {
	authTimeout := 150 * time.Millisecond
	rig := newRig(t, authTimeout)
	c := rig.dial(t)

	sendAuth(t, c, mintToken(t, testSecret, "user-1", time.Minute))
	readAuthOK(t, c)

	// Wait well beyond the auth timeout, then confirm the socket is still live:
	// a write succeeds and the user remains registered (no 4408 close fired).
	time.Sleep(3 * authTimeout)
	if err := c.WriteMessage(websocket.TextMessage, []byte("ping")); err != nil {
		t.Fatalf("connection should still be open after auth: %v", err)
	}
	if got := rig.registry.CountForUser("user-1"); got != 1 {
		t.Fatalf("connection deregistered prematurely: count=%d", got)
	}
}

func TestHealthIsNotRequiredForHandler(t *testing.T) {
	// Guards against accidentally requiring auth on a plain HTTP GET upgrade:
	// a non-websocket request should get a 400 from the upgrader, not a panic.
	rig := newRig(t, time.Second)
	resp, err := http.Get(rig.server.URL)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (non-ws request)", resp.StatusCode)
	}
}

func sendFrame(t *testing.T, c *websocket.Conn, frameType string) {
	t.Helper()
	if err := c.WriteJSON(clientFrame{Type: frameType}); err != nil {
		t.Fatalf("write %s frame: %v", frameType, err)
	}
}

// §5.1: a freshly authenticated socket is Idle, not Online (a live socket alone
// is not "online").
func TestPresenceDefaultsIdleAfterAuth(t *testing.T) {
	rig := newRig(t, time.Second)
	c := rig.dial(t)
	sendAuth(t, c, mintToken(t, testSecret, "user-1", time.Minute))
	readAuthOK(t, c)
	rig.waitForStatus(t, "user-1", presence.Idle)
}

// focus -> Online, blur -> Idle.
func TestFocusBlurDrivePresence(t *testing.T) {
	rig := newRig(t, time.Second)
	c := rig.dial(t)
	sendAuth(t, c, mintToken(t, testSecret, "user-1", time.Minute))
	readAuthOK(t, c)

	sendFrame(t, c, "focus")
	rig.waitForStatus(t, "user-1", presence.Online)

	sendFrame(t, c, "blur")
	rig.waitForStatus(t, "user-1", presence.Idle)
}

// §8.1: a ping gets a pong and keeps the connection's presence alive.
func TestPingPong(t *testing.T) {
	rig := newRig(t, time.Second)
	c := rig.dial(t)
	sendAuth(t, c, mintToken(t, testSecret, "user-1", time.Minute))
	readAuthOK(t, c)

	sendFrame(t, c, "ping")
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("expected pong: %v", err)
	}
	var f serverFrame
	if json.Unmarshal(data, &f) != nil || f.Type != "pong" {
		t.Fatalf("expected pong, got %s", string(data))
	}
}

// §5.3: closing the socket deregisters presence -> Offline (and a clean close
// is faster than waiting for the TTL to lapse).
func TestDisconnectGoesOffline(t *testing.T) {
	rig := newRig(t, time.Second)
	c := rig.dial(t)
	sendAuth(t, c, mintToken(t, testSecret, "user-1", time.Minute))
	readAuthOK(t, c)
	sendFrame(t, c, "focus")
	rig.waitForStatus(t, "user-1", presence.Online)

	_ = c.Close()
	rig.waitForStatus(t, "user-1", presence.Offline)
}
