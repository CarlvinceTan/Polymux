package link

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestAdvertise(t *testing.T) {
	const port = 7339
	instance := fmt.Sprintf("polymux-test-%d", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stop, err := Advertise(ctx, instance, port, []string{"127.0.0.1"}, map[string]string{"v": "1", "k": "test-fingerprint"})
	if err != nil {
		if runtime.GOOS == "darwin" {
			t.Fatal(err)
		}
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
	output, _ := exec.CommandContext(ctx, "/usr/bin/dns-sd", "-L", instance, "_polymux._tcp", "local.").CombinedOutput()
	text := string(output)
	if !strings.Contains(text, fmt.Sprintf(":%d", port)) || !strings.Contains(text, "v=1") || !strings.Contains(text, "k=test-fingerprint") {
		unavailable(fmt.Sprintf("local advertisement not resolved with port and TXT: %s", text))
	}
}

func TestAdvertiseEmpty(t *testing.T) {
	stop, err := Advertise(context.Background(), "test", 7339, nil, nil)
	if err == nil || stop != nil {
		t.Fatalf("Advertise without IPs: stop nil = %v, error = %v; want nil stop and error", stop == nil, err)
	}
}
