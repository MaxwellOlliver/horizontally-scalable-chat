// Package logstream is the gateway's half of the observability log feed (a
// study-project feature for making horizontal scaling visible). Two directions:
//
//   - Emitting: the gateway tags its own actions (auth, presence, frame receipt)
//     with this instance's id. Gateway logs always concern the socket it holds,
//     so they're written straight to that connection — no Redis round-trip, and
//     no subscribe/publish race on a just-opened socket.
//   - Forwarding: logs emitted by OTHER instances (auth/social/chat, or another
//     gateway) reach a user over Redis `logs:{id}`; the delivery hub already
//     subscribes to that channel and fans it out verbatim.
//
// The envelope matches @hsc/platform's `LogFrame`, a cross-language contract.
package logstream

import (
	"os"
	"regexp"
	"time"
)

// Frame is the wire envelope a client renders in its log panel.
type Frame struct {
	Type string `json:"type"`
	Data Data   `json:"data"`
}

// Data is the log payload: which instance did what, and when.
type Data struct {
	Instance string `json:"instance"`
	Source   string `json:"source"`
	Event    string `json:"event"`
	At       string `json:"at"`
}

// Logger builds log frames tagged with this gateway instance's id.
type Logger struct {
	instanceID string
}

// New builds a Logger for the given instance id (see ResolveInstanceID).
func New(instanceID string) *Logger { return &Logger{instanceID: instanceID} }

// InstanceID is this gateway instance's id (e.g. `ws-gateway-a3f1`).
func (l *Logger) InstanceID() string { return l.instanceID }

// Frame builds a log envelope for an event, stamped now (UTC).
func (l *Logger) Frame(event string) Frame {
	return Frame{
		Type: "log",
		Data: Data{
			Instance: l.instanceID,
			Source:   "ws-gateway",
			Event:    event,
			At:       time.Now().UTC().Format(time.RFC3339Nano),
		},
	}
}

var nonAlphanum = regexp.MustCompile(`[^a-zA-Z0-9]`)

// ResolveInstanceID derives this process's id, mirroring @hsc/platform's
// resolveInstanceId: an explicit INSTANCE_ID wins; otherwise it is
// `ws-gateway-{short hostname}`. Under `docker compose --scale` each replica has
// a distinct container hostname, so the ids stay unique without per-replica
// configuration.
func ResolveInstanceID() string {
	if explicit := os.Getenv("INSTANCE_ID"); explicit != "" {
		return explicit
	}
	host := os.Getenv("HOSTNAME")
	if host == "" {
		host, _ = os.Hostname()
	}
	host = nonAlphanum.ReplaceAllString(host, "")
	if len(host) > 6 {
		host = host[:6]
	}
	if host == "" {
		host = "local"
	}
	return "ws-gateway-" + host
}
