package ws

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// writeWait bounds a single socket write so a wedged client can't pin a writer
// goroutine forever.
const writeWait = 10 * time.Second

// connection wraps a gorilla socket with a single-writer goroutine. Gorilla
// forbids concurrent writes, but the gateway now has multiple write sources —
// the read loop (auth_ok / pong) and the delivery hub (pushed frames) — so all
// writes funnel through one `send` channel drained by writePump.
type connection struct {
	ws        *websocket.Conn
	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once
}

// newConnection starts the writer goroutine for an (already authenticated) socket.
func newConnection(ws *websocket.Conn) *connection {
	c := &connection{
		ws:   ws,
		send: make(chan []byte, 32),
		done: make(chan struct{}),
	}
	go c.writePump()
	return c
}

// Enqueue queues a raw frame for delivery (delivery.Conn). Non-blocking: if the
// buffer is full (slow consumer) or the connection is closing, the frame is
// dropped — delivery is best-effort and the client recovers missed data on
// resync (REQUIREMENTS §8.3).
func (c *connection) Enqueue(frame []byte) {
	select {
	case c.send <- frame:
	case <-c.done:
	default:
	}
}

// sendJSON marshals and enqueues a server frame (auth_ok, pong).
func (c *connection) sendJSON(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.Enqueue(b)
}

// writePump is the sole writer to the socket. It exits on close, which also
// unblocks any pending Enqueue.
func (c *connection) writePump() {
	for {
		select {
		case <-c.done:
			return
		case frame := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.TextMessage, frame); err != nil {
				return
			}
		}
	}
}

// close stops the writer and closes the socket. Idempotent.
func (c *connection) close() {
	c.closeOnce.Do(func() {
		close(c.done)
		_ = c.ws.Close()
	})
}
