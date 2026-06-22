// Package inbound is the gateway's inbound half (messaging spec §2.2): it stamps
// the authenticated senderId onto a client's `message.send` and publishes the
// envelope to the chat-service work queue. The gateway does NO validation and no
// DB work — a chat-service worker (competing consumer) owns the gate, persist
// and fan-out.
package inbound

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Envelope is the inbound work-queue message. `SenderID` is stamped by the
// gateway from the authenticated connection — never trusted from the client.
type Envelope struct {
	Type        string `json:"type"`
	ClientMsgID string `json:"clientMsgId"`
	SenderID    string `json:"senderId"`
	ToUserID    string `json:"toUserId"`
	Body        string `json:"body"`
}

// Publisher hands a stamped envelope to the inbound queue.
type Publisher interface {
	Publish(env Envelope) error
}

// RabbitPublisher publishes persistent JSON to a durable work queue via the
// default exchange (routing key == queue name). The connection/channel are
// established lazily and reused; concurrent sends are serialized.
type RabbitPublisher struct {
	url   string
	queue string

	mu      sync.Mutex
	conn    *amqp.Connection
	channel *amqp.Channel
}

// NewRabbitPublisher builds a publisher for the given broker URL + queue.
func NewRabbitPublisher(url, queue string) *RabbitPublisher {
	return &RabbitPublisher{url: url, queue: queue}
}

// Publish stamps and enqueues an envelope. It (re)connects on demand so a broker
// restart self-heals on the next send.
func (p *RabbitPublisher) Publish(env Envelope) error {
	body, err := json.Marshal(env)
	if err != nil {
		return err
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensure(); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err = p.channel.PublishWithContext(ctx, "", p.queue, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Timestamp:    time.Now(),
		Body:         body,
	})
	if err != nil {
		// Drop the channel so the next send rebuilds it (the connection may be
		// dead). Best-effort: the caller logs; the client will retry on resync.
		p.reset()
	}
	return err
}

// ensure lazily opens the connection + channel and declares the durable queue.
// Caller holds p.mu.
func (p *RabbitPublisher) ensure() error {
	if p.channel != nil {
		return nil
	}
	conn, err := amqp.Dial(p.url)
	if err != nil {
		return err
	}
	channel, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return err
	}
	if _, err := channel.QueueDeclare(p.queue, true, false, false, false, nil); err != nil {
		_ = conn.Close()
		return err
	}
	p.conn, p.channel = conn, channel
	return nil
}

// reset discards the current connection so ensure() rebuilds it. Caller holds p.mu.
func (p *RabbitPublisher) reset() {
	if p.conn != nil {
		_ = p.conn.Close()
	}
	p.conn, p.channel = nil, nil
}

// Close tears down the connection (graceful shutdown).
func (p *RabbitPublisher) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn != nil {
		err := p.conn.Close()
		p.conn, p.channel = nil, nil
		return err
	}
	return nil
}
