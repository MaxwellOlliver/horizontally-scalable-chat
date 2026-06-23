package ws

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// readFrame reads one text frame and returns its decoded type + raw bytes.
func readFrame(t *testing.T, c *websocket.Conn) (string, []byte) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	var f struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("decode frame: %v", err)
	}
	return f.Type, data
}

// TestInboundStampsSenderAndPublishes — a client `message.send` is published to
// the inbound work queue with the authenticated senderId stamped (spec §2.2).
func TestInboundStampsSenderAndPublishes(t *testing.T) {
	rig := newRig(t, time.Second)
	conn := rig.dial(t)
	sendAuth(t, conn, mintToken(t, testSecret, "sender-1", time.Minute))
	readAuthOK(t, conn)

	// The client never supplies senderId; the gateway stamps it from the token.
	if err := conn.WriteJSON(map[string]any{
		"type":        "message.send",
		"clientMsgId": "tmp-1",
		"toUserId":    "recipient-9",
		"body":        "hello there",
	}); err != nil {
		t.Fatalf("write message.send: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(rig.inbound.all()) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	published := rig.inbound.all()
	if len(published) != 1 {
		t.Fatalf("expected 1 published envelope, got %d", len(published))
	}
	env := published[0]
	if env.Type != "message.send" || env.SenderID != "sender-1" ||
		env.ToUserID != "recipient-9" || env.ClientMsgID != "tmp-1" || env.Body != "hello there" {
		t.Fatalf("unexpected envelope: %+v", env)
	}
}

// TestOutboundFanoutToAllDevices — a frame published to a user's Redis channel
// is fanned out to every local socket that user holds (spec §2.3, AC-D1/D3).
func TestOutboundFanoutToAllDevices(t *testing.T) {
	rig := newRig(t, time.Second)

	// Two devices for the same user.
	dev1 := rig.dial(t)
	sendAuth(t, dev1, mintToken(t, testSecret, "user-multi", time.Minute))
	readAuthOK(t, dev1)
	dev2 := rig.dial(t)
	sendAuth(t, dev2, mintToken(t, testSecret, "user-multi", time.Minute))
	readAuthOK(t, dev2)

	// Give both subscriptions time to register before publishing.
	waitForSubscribers(t, rig, "user:user-multi", 1)

	frame := `{"type":"message.received","data":{"body":"hi"}}`
	if err := rig.rdb.Publish(context.Background(), "user:user-multi", frame).Err(); err != nil {
		t.Fatalf("publish: %v", err)
	}

	for i, dev := range []*websocket.Conn{dev1, dev2} {
		typ, raw := readFrame(t, dev)
		if typ != "message.received" {
			t.Fatalf("device %d: expected message.received, got %q (%s)", i, typ, raw)
		}
	}
}

// TestOutboundUnsubscribesOnLastDisconnect — once a user's last local socket
// closes, the gateway drops the Redis subscription (spec §2.3).
func TestOutboundUnsubscribesOnLastDisconnect(t *testing.T) {
	rig := newRig(t, time.Second)
	conn := rig.dial(t)
	sendAuth(t, conn, mintToken(t, testSecret, "user-solo", time.Minute))
	readAuthOK(t, conn)
	waitForSubscribers(t, rig, "user:user-solo", 1)

	_ = conn.Close()

	// After the last disconnect the channel should have zero subscribers.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if subscriberCount(t, rig, "user:user-solo") == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("subscription for user-solo was not torn down")
}

func subscriberCount(t *testing.T, rig *testRig, channel string) int {
	t.Helper()
	res, err := rig.rdb.PubSubNumSub(context.Background(), channel).Result()
	if err != nil {
		t.Fatalf("PUBSUB NUMSUB: %v", err)
	}
	return int(res[channel])
}

func waitForSubscribers(t *testing.T, rig *testRig, channel string, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if subscriberCount(t, rig, channel) >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("channel %s did not reach %d subscribers", channel, want)
}
