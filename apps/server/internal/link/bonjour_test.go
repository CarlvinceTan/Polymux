package link

import (
	"context"
	"fmt"
	"runtime"
	"slices"
	"testing"
	"time"

	"github.com/grandcat/zeroconf"
)

func TestAdvertise(t *testing.T) {
	const port = 7339
	instance := fmt.Sprintf("polymux-test-%d", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stop, err := Advertise(ctx, instance, port, []string{"127.0.0.1"}, map[string]string{"v": "1", "k": "test-fingerprint"})
	if err != nil {
		t.Skipf("multicast advertisement unavailable: %v", err)
	}
	defer stop()
	unavailable := func(message string) {
		t.Helper()
		if runtime.GOOS == "darwin" {
			t.Fatal(message)
		}
		t.Skip(message)
	}
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		unavailable(fmt.Sprintf("multicast resolver unavailable: %v", err))
	}
	entries := make(chan *zeroconf.ServiceEntry)
	if err := resolver.Browse(ctx, "_polymux._tcp", "local.", entries); err != nil {
		unavailable(fmt.Sprintf("multicast browse unavailable: %v", err))
	}
	for {
		select {
		case entry, ok := <-entries:
			if !ok {
				unavailable("multicast browse ended without discovering the local advertisement")
			}
			if entry.Instance != instance {
				continue
			}
			if entry.Port != port {
				t.Errorf("port = %d, want %d", entry.Port, port)
			}
			if !slices.Contains(entry.Text, "v=1") || !slices.Contains(entry.Text, "k=test-fingerprint") {
				t.Errorf("TXT = %v, want version and fingerprint", entry.Text)
			}
			return
		case <-ctx.Done():
			unavailable(fmt.Sprintf("multicast unavailable: local advertisement not discovered within 5s: %v", ctx.Err()))
		}
	}
}

func TestAdvertiseEmpty(t *testing.T) {
	stop, err := Advertise(context.Background(), "test", 7339, nil, nil)
	if err == nil || stop != nil {
		t.Fatalf("Advertise without IPs: stop nil = %v, error = %v; want nil stop and error", stop == nil, err)
	}
}
