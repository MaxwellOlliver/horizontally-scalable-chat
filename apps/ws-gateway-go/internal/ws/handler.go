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

// clientFrame is any post-auth message. `type` selects the handler; the other
// fields are read per type (`message.send` body, `presence.subscribe` userIds).
type clientFrame struct {
	Type        string   `json:"type"`
	ClientMsgID string   `json:"clientMsgId"`
	ToUserID    string   `json:"toUserId"`
	Body        string   `json:"body"`
	UserIDs     []string `json:"userIds"`
	// receipt fields
	ConversationID string `json:"conversationId"`
	DeliveredUpTo  string `json:"deliveredUpTo"`
	ReadUpTo       string `json:"readUpTo"`
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
// per-user channel and fans pushed frames back to it, and publishes frames to a
// user's channel (for relaying ephemeral signals like typing). delivery.Hub.
type Deliverer interface {
	Register(userID string, c delivery.Conn)
	Unregister(userID string, c delivery.Conn)
	Publish(ctx context.Context, userID string, frame []byte) error
}

// Inbound is the inbound side: it enqueues stamped client messages and receipts
// onto the chat-service work queue (inbound.RabbitPublisher).
type Inbound interface {
	Publish(env inbound.Envelope) error
	PublishReceipt(env inbound.ReceiptEnvelope) error
}

// PresenceFeed lets a connection watch other users' presence (presence.Feed).
type PresenceFeed interface {
	Watch(ctx context.Context, userID string, sink presence.Sink)
	Unwatch(userID string, sink presence.Sink)
}

// Handler upgrades HTTP requests to WebSocket connections and enforces the
// handshake-auth protocol before registering them.
type Handler struct {
	verifier     Verifier
	registry     *registry.Registry
	presence     Presence
	delivery     Deliverer
	inbound      Inbound
	presenceFeed PresenceFeed
	authTimeout  time.Duration
	upgrader     websocket.Upgrader
}

// NewHandler builds a Handler. The origin check is permissive here because TLS
// and origin enforcement terminate at Nginx in deploy (spec §2.1). `del`, `in`
// and `feed` are the messaging relay + presence feed; any may be nil to run the
// gateway without that path (e.g. presence-only tests).
func NewHandler(
	v Verifier,
	reg *registry.Registry,
	pres Presence,
	del Deliverer,
	in Inbound,
	feed PresenceFeed,
	authTimeout time.Duration,
) *Handler {
	return &Handler{
		verifier:     v,
		registry:     reg,
		presence:     pres,
		delivery:     del,
		inbound:      in,
		presenceFeed: feed,
		authTimeout:  authTimeout,
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
//   - ping              -> pong + presence heartbeat (refresh TTL, §8.1)
//   - focus             -> presence Online (§5.1)
//   - blur              -> presence Idle
//   - message.send      -> stamp senderId, publish to the inbound work queue (§2.2)
//   - presence.subscribe -> watch the listed users' presence (§5.4)
//
// Unknown frames are ignored.
func (h *Handler) serve(c *connection, userID, connID string) {
	ctx := context.Background()
	// Users this connection is watching presence for (in this app, 0 or 1 — the
	// open conversation's friend). Torn down on disconnect.
	watched := map[string]struct{}{}
	defer h.unwatchAll(watched, c)

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
		case "presence.subscribe":
			h.updateWatched(ctx, watched, c, f.UserIDs)
		case "typing.start":
			h.relayTyping(ctx, userID, f.ToUserID, true)
		case "typing.stop":
			h.relayTyping(ctx, userID, f.ToUserID, false)
		case "receipt":
			h.publishReceipt(userID, f)
		}
	}
}

// publishReceipt stamps the authenticated reporter onto a delivery/read receipt
// and enqueues it for chat-service (REQUIREMENTS §4). Best-effort.
func (h *Handler) publishReceipt(userID string, f clientFrame) {
	if h.inbound == nil {
		return
	}
	err := h.inbound.PublishReceipt(inbound.ReceiptEnvelope{
		Type:           "receipt",
		UserID:         userID, // never trust a client-supplied reporter
		ConversationID: f.ConversationID,
		DeliveredUpTo:  f.DeliveredUpTo,
		ReadUpTo:       f.ReadUpTo,
	})
	if err != nil {
		log.Printf("receipt publish failed for %s: %v", userID, err)
	}
}

// typingFrame is the ephemeral signal forwarded to the conversation partner.
type typingFrame struct {
	Type string     `json:"type"`
	Data typingData `json:"data"`
}

type typingData struct {
	UserID string `json:"userId"`
}

// relayTyping forwards a typing signal to the recipient's per-user channel,
// stamped with the authenticated sender (never client-supplied). Ephemeral and
// best-effort: never persisted, never acked (REQUIREMENTS §6).
func (h *Handler) relayTyping(ctx context.Context, from, to string, typing bool) {
	if h.delivery == nil || to == "" {
		return
	}
	frameType := "typing.stop"
	if typing {
		frameType = "typing.start"
	}
	payload, err := json.Marshal(typingFrame{Type: frameType, Data: typingData{UserID: from}})
	if err != nil {
		return
	}
	if err := h.delivery.Publish(ctx, to, payload); err != nil {
		log.Printf("typing relay failed %s->%s: %v", from, to, err)
	}
}

// updateWatched reconciles the connection's watched-user set against the
// declarative `presence.subscribe` list — subscribing to the newly-listed users
// and unsubscribing from the dropped ones.
func (h *Handler) updateWatched(ctx context.Context, watched map[string]struct{}, c *connection, userIDs []string) {
	if h.presenceFeed == nil {
		return
	}
	next := make(map[string]struct{}, len(userIDs))
	for _, id := range userIDs {
		if id != "" {
			next[id] = struct{}{}
		}
	}
	for id := range watched {
		if _, keep := next[id]; !keep {
			h.presenceFeed.Unwatch(id, c)
			delete(watched, id)
		}
	}
	for id := range next {
		if _, have := watched[id]; !have {
			h.presenceFeed.Watch(ctx, id, c)
			watched[id] = struct{}{}
		}
	}
}

func (h *Handler) unwatchAll(watched map[string]struct{}, c *connection) {
	if h.presenceFeed == nil {
		return
	}
	for id := range watched {
		h.presenceFeed.Unwatch(id, c)
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
