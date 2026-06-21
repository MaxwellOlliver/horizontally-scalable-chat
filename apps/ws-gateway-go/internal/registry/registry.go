// Package registry tracks authenticated connections keyed by user id. This is
// the gateway-local presence map; the authenticated user id is the connection's
// identity used for routing (AC-W5).
//
// NOTE: cross-instance presence (Redis SADD + TTL, spec §2.4 / REQUIREMENTS §5)
// belongs to the later presence task — this local registry is the identity hook
// the WS-auth task (T8) needs and is deliberately storage-agnostic.
package registry

import "sync"

// Registry is a concurrency-safe map of user id -> set of live connections.
// A single user may hold several connections (multi-device, multi-tab).
type Registry struct {
	mu    sync.RWMutex
	conns map[string]map[any]struct{}
}

// New creates an empty Registry.
func New() *Registry {
	return &Registry{conns: make(map[string]map[any]struct{})}
}

// Add registers a connection under userID. conn is an opaque handle (the WS
// connection); using `any` keeps this package free of a websocket dependency.
func (r *Registry) Add(userID string, conn any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	set, ok := r.conns[userID]
	if !ok {
		set = make(map[any]struct{})
		r.conns[userID] = set
	}
	set[conn] = struct{}{}
}

// Remove deregisters a connection, dropping the user entirely once their last
// connection closes.
func (r *Registry) Remove(userID string, conn any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	set, ok := r.conns[userID]
	if !ok {
		return
	}
	delete(set, conn)
	if len(set) == 0 {
		delete(r.conns, userID)
	}
}

// CountForUser returns how many live connections a user currently holds.
func (r *Registry) CountForUser(userID string) int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.conns[userID])
}
