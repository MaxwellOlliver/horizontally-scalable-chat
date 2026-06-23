package ws

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"

	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/auth"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/delivery"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/logstream"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/presence"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/registry"
)

// logRig is a handler wired with a real log stream (the shared rig disables it
// to keep frame assertions clean).
type logRig struct {
	url string
	rdb *redis.Client
}

func newLogRig(t *testing.T) *logRig {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	reg := registry.New()
	pres := presence.NewRedisStore(rdb, 30*time.Second)
	hub := delivery.NewHub(rdb)
	t.Cleanup(hub.Close)
	feed := presence.NewFeed(rdb, pres)
	logger := logstream.New("ws-gateway-test")
	h := NewHandler(auth.NewVerifier(testSecret, testIssuer), reg, pres, hub, &stubInbound{}, feed, logger, time.Second)
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &logRig{url: "ws" + strings.TrimPrefix(srv.URL, "http"), rdb: rdb}
}

// readLog reads the next frame and asserts it is a log frame, returning its data.
func readLog(t *testing.T, c *websocket.Conn) logstream.Data {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("expected a log frame, got error: %v", err)
	}
	var f logstream.Frame
	if err := json.Unmarshal(data, &f); err != nil || f.Type != "log" {
		t.Fatalf("expected a log frame, got %s", string(data))
	}
	return f.Data
}

func TestLogStream_EmitsGatewayActionsToTheSocket(t *testing.T) {
	r := newLogRig(t)
	c, _, err := websocket.DefaultDialer.Dial(r.url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })

	sendAuth(t, c, mintToken(t, testSecret, "user-1", time.Minute))
	readAuthOK(t, c)

	// First post-auth frame is the "Connected" log, tagged with this instance.
	connected := readLog(t, c)
	if connected.Event != "Connected" {
		t.Fatalf("event = %q, want Connected", connected.Event)
	}
	if connected.Instance != "ws-gateway-test" || connected.Source != "ws-gateway" {
		t.Fatalf("bad tag: instance=%q source=%q", connected.Instance, connected.Source)
	}

	if err := c.WriteJSON(clientFrame{Type: "focus"}); err != nil {
		t.Fatalf("write focus: %v", err)
	}
	if got := readLog(t, c).Event; got != "Presence changed to Online" {
		t.Fatalf("event = %q, want Presence changed to Online", got)
	}

	if err := c.WriteJSON(clientFrame{Type: "message.send", ToUserID: "user-2", Body: "hi"}); err != nil {
		t.Fatalf("write message.send: %v", err)
	}
	if got := readLog(t, c).Event; got != "Message frame received" {
		t.Fatalf("event = %q, want Message frame received", got)
	}
}

func TestLogStream_ForwardsServiceOriginLogs(t *testing.T) {
	r := newLogRig(t)
	c, _, err := websocket.DefaultDialer.Dial(r.url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })

	sendAuth(t, c, mintToken(t, testSecret, "user-1", time.Minute))
	readAuthOK(t, c)
	readLog(t, c) // drain the "Connected" gateway log

	// A log published by another instance (e.g. chat-service) to logs:{id} must be
	// forwarded to the user's socket verbatim — the cross-instance path.
	frame := logstream.Frame{Type: "log", Data: logstream.Data{
		Instance: "chat-service-abc123", Source: "chat-service", Event: "Message sent",
		At: time.Now().UTC().Format(time.RFC3339Nano),
	}}
	payload, _ := json.Marshal(frame)
	// Give the hub's subscription a moment to be live, then publish.
	waitFor(t, func() bool {
		return r.rdb.Publish(context.Background(), "logs:user-1", payload).Val() >= 1
	})

	got := readLog(t, c)
	if got.Instance != "chat-service-abc123" || got.Event != "Message sent" {
		t.Fatalf("forwarded log = %+v, want chat-service Message sent", got)
	}
}

// waitFor polls cond until true or a short deadline, so a freshly-opened Redis
// subscription has time to register before we assert delivery.
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not met before deadline")
}
