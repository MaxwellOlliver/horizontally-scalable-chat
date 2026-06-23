package presence

import (
	"context"
	"log"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Sink is a connection the Feed can push presence frames to (implemented by the
// ws connection). Kept minimal so this package never imports ws.
type Sink interface {
	Enqueue(frame []byte)
}

// Feed forwards friends' presence to the sockets watching them. A client sends
// `presence.subscribe { userIds }` for the users it cares about (in this app,
// just the open conversation's friend); the gateway subscribes to those users'
// `presence-feed:{id}` Redis channels (so changes from any gateway instance are
// followed) and forwards them. On the first watch of a user it also pushes the
// current status immediately. Mirrors delivery.Hub, with the initial-state send.
type Feed struct {
	rdb   redis.UniversalClient
	store Store
	mu    sync.Mutex
	watch map[string]*watchGroup
}

type watchGroup struct {
	sinks  map[Sink]struct{}
	pubsub *redis.PubSub
	cancel context.CancelFunc
}

func NewFeed(rdb redis.UniversalClient, store Store) *Feed {
	return &Feed{rdb: rdb, store: store, watch: make(map[string]*watchGroup)}
}

// Watch subscribes sink to userID's presence, subscribing to Redis on the first
// watcher, and immediately sends the current status to this sink.
func (f *Feed) Watch(ctx context.Context, userID string, sink Sink) {
	f.mu.Lock()
	group, ok := f.watch[userID]
	if !ok {
		group = f.subscribe(userID)
		f.watch[userID] = group
	}
	group.sinks[sink] = struct{}{}
	f.mu.Unlock()

	f.sendCurrent(ctx, userID, sink) // outside the lock (a Redis read)
}

// Unwatch drops sink from userID, tearing down the Redis subscription on the
// last watcher.
func (f *Feed) Unwatch(userID string, sink Sink) {
	f.mu.Lock()
	defer f.mu.Unlock()
	group, ok := f.watch[userID]
	if !ok {
		return
	}
	delete(group.sinks, sink)
	if len(group.sinks) == 0 {
		group.cancel()
		_ = group.pubsub.Close()
		delete(f.watch, userID)
	}
}

// subscribe opens the Redis subscription + pump. Caller holds f.mu.
func (f *Feed) subscribe(userID string) *watchGroup {
	ctx, cancel := context.WithCancel(context.Background())
	pubsub := f.rdb.Subscribe(ctx, presenceChannel(userID))
	group := &watchGroup{sinks: make(map[Sink]struct{}), pubsub: pubsub, cancel: cancel}
	go f.pump(ctx, userID, pubsub)
	return group
}

func (f *Feed) pump(ctx context.Context, userID string, pubsub *redis.PubSub) {
	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			f.fanout(userID, []byte(msg.Payload))
		}
	}
}

func (f *Feed) fanout(userID string, frame []byte) {
	f.mu.Lock()
	group, ok := f.watch[userID]
	if !ok {
		f.mu.Unlock()
		return
	}
	sinks := make([]Sink, 0, len(group.sinks))
	for s := range group.sinks {
		sinks = append(sinks, s)
	}
	f.mu.Unlock()

	for _, s := range sinks {
		s.Enqueue(frame)
	}
}

// sendCurrent reads the user's effective status now and pushes it to a single
// sink — the initial state a freshly-opened conversation needs.
func (f *Feed) sendCurrent(ctx context.Context, userID string, sink Sink) {
	st, err := f.store.Effective(ctx, userID)
	if err != nil {
		log.Printf("presence feed: initial status for %s: %v", userID, err)
		return
	}
	sink.Enqueue(changePayload(userID, st))
}

// Close tears down every active subscription (graceful shutdown).
func (f *Feed) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for userID, group := range f.watch {
		group.cancel()
		_ = group.pubsub.Close()
		delete(f.watch, userID)
	}
}
