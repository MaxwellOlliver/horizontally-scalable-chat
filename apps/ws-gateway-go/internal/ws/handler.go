// Package ws implements the WebSocket handshake-auth protocol (spec §2.4):
// first-frame auth token, local verification, a bounded auth timer, and the
// 4401/4408 close codes. After auth it maintains the connection's presence in
// Redis via heartbeat/focus/blur frames (REQUIREMENTS §5).
package ws

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"

	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/auth"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/delivery"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/inbound"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/presence"
	"github.com/maxwellolliver/horizontally-scalable-chat/ws-gateway-go/internal/registry"
)

// Application-private WebSocket close codes (spec "Decisions").
const (
	closeUnauthorized = 4401 // missing/malformed/expired/bad-signature token (AC-W4)
	closeAuthTimeout  = 4408 // no valid auth frame within the auth timeout (AC-W3)
)

// authFrame is the first message the client must send (spec §2.4 step 2):
//
//	{ "type": "auth", "token": "<access token>" }
type authFrame struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

// clientFrame is any post-auth message. `type` selects the handler; the message
// fields are only read for `message.send` (the rest are presence signals).
type clientFrame struct {
	Type        string `json:"type"`
	ClientMsgID string `json:"clientMsgId"`
	ToUserID    string `json:"toUserId"`
	Body        string `json:"body"`
}

// serverFrame is the gateway's reply envelope (e.g. {"type":"auth_ok"}).
type serverFrame struct {
	Type string `json:"type"`
}

// Verifier is the subset of auth.Verifier the handler needs (kept as an
// interface so tests can substitute a stub).
type Verifier interface {
	Verify(token string) (*auth.Claims, error)
}

// Presence is the subset of presence.Store the handler drives.
type Presence interface {
	Register(ctx context.Context, userID, connID string, st presence.Status) error
	Heartbeat(ctx context.Context, userID, connID string) error
	SetState(ctx context.Context, userID, connID string, st presence.Status) error
	Remove(ctx context.Context, userID, connID string) error
}

// Deliverer is the outbound side: it subscribes a connection to its user's
// per-user channel and fans pushed frames back to it (delivery.Hub).
type Deliverer interface {
	Register(userID string, c delivery.Conn)
	Unregister(userID string, c delivery.Conn)
}

// Inbound is the inbound side: it enqueues a stamped `message.send` envelope onto
// the chat-service work queue (inbound.RabbitPublisher).
type Inbound interface {
	Publish(env inbound.Envelope) error
}

// Handler upgrades HTTP requests to WebSocket connections and enforces the
// handshake-auth protocol before registering them.
type Handler struct {
	verifier    Verifier
	registry    *registry.Registry
	presence    Presence
	delivery    Deliverer
	inbound     Inbound
	authTimeout time.Duration
	upgrader    websocket.Upgrader
}

// NewHandler builds a Handler. The origin check is permissive here because TLS
// and origin enforcement terminate at Nginx in deploy (spec §2.1). `del` and
// `in` are the messaging relay (outbound fan-out / inbound publish); either may
// be nil to run the gateway without the chat path (e.g. presence-only tests).
func NewHandler(
	v Verifier,
	reg *registry.Registry,
	pres Presence,
	del Deliverer,
	in Inbound,
	authTimeout time.Duration,
) *Handler {
	return &Handler{
		verifier:    v,
		registry:    reg,
		presence:    pres,
		delivery:    del,
		inbound:     in,
		authTimeout: authTimeout,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
	}
}

// ServeHTTP performs the upgrade then runs the auth handshake. A connection is
// registered (and its read loop started) ONLY after a successful auth (AC-W2).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already wrote an HTTP error response.
	}

	userID, closeCode, err := h.authenticate(conn)
	if err != nil {
		writeClose(conn, closeCode, "authentication failed")
		return // SHALL NOT register (AC-W3/W4).
	}

	// AC-C1: authenticated at handshake only. Clear the read deadline so the
	// established connection persists for its lifetime even if the access token
	// later expires — revocation lives at the (short-lived) token layer.
	_ = conn.SetReadDeadline(time.Time{})

	// AC-W5: the user id is the connection's identity. connID disambiguates this
	// socket among the user's devices for presence.
	connID := newConnID()
	h.registry.Add(userID, conn)
	defer h.registry.Remove(userID, conn)

	// Wrap the socket in a single-writer connection now that auth succeeded: both
	// the read loop and the delivery hub write through it.
	c := newConnection(conn)
	defer c.close()

	// Subscribe this socket to the user's outbound channel (spec §2.3); the hub
	// unsubscribes from Redis on the user's last local disconnect.
	if h.delivery != nil {
		h.delivery.Register(userID, c)
		defer h.delivery.Unregister(userID, c)
	}

	// §5.1: a live socket is not yet "online" — default to Idle until the client
	// reports focus. Presence is best-effort: Redis being down must not drop the
	// connection (auth never depends on it).
	ctx := context.Background()
	logPresence("register", h.presence.Register(ctx, userID, connID, presence.Idle))
	// NOTE: wrap in a closure — a bare `defer logPresence(..., Remove(...))` would
	// evaluate Remove immediately (defer args are evaluated at the defer stmt),
	// deregistering the connection the instant it connects.
	defer func() {
		logPresence("remove", h.presence.Remove(context.Background(), userID, connID))
	}()

	c.sendJSON(serverFrame{Type: "auth_ok"})

	h.serve(c, userID, connID)
}

// authenticate reads and validates the mandatory first frame. It returns the
// authenticated user id, or the WebSocket close code to use on failure.
func (h *Handler) authenticate(conn *websocket.Conn) (userID string, closeCode int, err error) {
	// Bound the wait for the first frame (AC-W3): the timer starts at open.
	_ = conn.SetReadDeadline(time.Now().Add(h.authTimeout))

	_, data, err := conn.ReadMessage()
	if err != nil {
		if isTimeout(err) {
			return "", closeAuthTimeout, err
		}
		// Client closed/errored before sending a valid frame — unauthorized.
		return "", closeUnauthorized, err
	}

	var frame authFrame
	if err := json.Unmarshal(data, &frame); err != nil || frame.Type != "auth" {
		return "", closeUnauthorized, errors.New("first frame is not a valid auth frame")
	}

	claims, err := h.verifier.Verify(frame.Token)
	if err != nil {
		return "", closeUnauthorized, err
	}
	return claims.UserID, 0, nil
}

// serve handles post-auth frames until the connection closes:
//   - ping         -> pong + presence heartbeat (refresh TTL, §8.1)
//   - focus        -> presence Online (§5.1)
//   - blur         -> presence Idle
//   - message.send -> stamp senderId, publish to the inbound work queue (§2.2)
//
// Unknown frames are ignored.
func (h *Handler) serve(c *connection, userID, connID string) {
	ctx := context.Background()
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		var f clientFrame
		if json.Unmarshal(data, &f) != nil {
			continue
		}
		switch f.Type {
		case "ping":
			logPresence("heartbeat", h.presence.Heartbeat(ctx, userID, connID))
			c.sendJSON(serverFrame{Type: "pong"})
		case "focus":
			logPresence("focus", h.presence.SetState(ctx, userID, connID, presence.Online))
		case "blur":
			logPresence("blur", h.presence.SetState(ctx, userID, connID, presence.Idle))
		case "message.send":
			h.publishInbound(userID, f)
		}
	}
}

// publishInbound stamps the authenticated senderId onto the client's
// `message.send` and hands it to the inbound work queue (spec §2.2). The gateway
// does no validation: a chat-service worker owns the gate, persist and fan-out.
// Best-effort — a broker hiccup is logged and the client retries on resync.
func (h *Handler) publishInbound(userID string, f clientFrame) {
	if h.inbound == nil {
		return
	}
	err := h.inbound.Publish(inbound.Envelope{
		Type:        "message.send",
		ClientMsgID: f.ClientMsgID,
		SenderID:    userID, // never trust a client-supplied sender
		ToUserID:    f.ToUserID,
		Body:        f.Body,
	})
	if err != nil {
		log.Printf("inbound publish failed for %s: %v", userID, err)
	}
}

// writeClose sends a WebSocket close control frame with a custom code, then
// closes the underlying connection. Best-effort: the peer may already be gone.
func writeClose(conn *websocket.Conn, code int, reason string) {
	msg := websocket.FormatCloseMessage(code, reason)
	_ = conn.WriteControl(websocket.CloseMessage, msg, time.Now().Add(time.Second))
	_ = conn.Close()
}

// logPresence records a best-effort presence failure without tearing down the
// connection.
func logPresence(op string, err error) {
	if err != nil {
		log.Printf("presence %s failed: %v", op, err)
	}
}

// newConnID returns a random 128-bit hex id identifying a single socket.
func newConnID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// isTimeout reports whether err is a read-deadline timeout (the auth-timer
// firing) versus any other read failure.
func isTimeout(err error) bool {
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	return errors.Is(err, os.ErrDeadlineExceeded)
}
