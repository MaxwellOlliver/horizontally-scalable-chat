package logstream

import (
	"testing"
)

func TestFrame_ShapeAndTags(t *testing.T) {
	f := New("ws-gateway-test").Frame("Connected")
	if f.Type != "log" {
		t.Fatalf("type = %q, want log", f.Type)
	}
	if f.Data.Instance != "ws-gateway-test" || f.Data.Source != "ws-gateway" {
		t.Fatalf("bad tags: %+v", f.Data)
	}
	if f.Data.Event != "Connected" || f.Data.At == "" {
		t.Fatalf("bad event/at: %+v", f.Data)
	}
}

func TestResolveInstanceID(t *testing.T) {
	t.Setenv("INSTANCE_ID", "")
	t.Setenv("HOSTNAME", "abcdef0123456789")
	if got := ResolveInstanceID(); got != "ws-gateway-abcdef" {
		t.Fatalf("got %q, want ws-gateway-abcdef (short hostname)", got)
	}

	t.Setenv("INSTANCE_ID", "ws-gateway-7")
	if got := ResolveInstanceID(); got != "ws-gateway-7" {
		t.Fatalf("got %q, want explicit INSTANCE_ID to win", got)
	}
}
