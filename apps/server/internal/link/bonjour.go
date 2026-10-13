package link

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"

	"github.com/grandcat/zeroconf"
)

func Advertise(ctx context.Context, instance string, port int, ips []string, txt map[string]string) (stop func(), err error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if instance == "" || port < 1 || port > 65535 {
		return nil, fmt.Errorf("invalid bonjour instance or port")
	}
	records := make([]string, 0, len(txt))
	for key, value := range txt {
		records = append(records, key+"="+value)
	}
	sort.Strings(records)
	if len(ips) == 0 {
		return nil, fmt.Errorf("bonjour requires at least one IP")
	}
	host, err := os.Hostname()
	if err != nil {
		return nil, fmt.Errorf("bonjour hostname: %w", err)
	}
	host, _, _ = strings.Cut(host, ".")
	server, err := zeroconf.RegisterProxy(
		instance, "_polymux._tcp", "local.", port, host, ips, records, nil,
	)
	if err != nil {
		return nil, fmt.Errorf("advertise bonjour: %w", err)
	}
	done := make(chan struct{})
	var once sync.Once
	stop = func() {
		once.Do(func() {
			server.Shutdown()
			close(done)
		})
	}
	go func() {
		select {
		case <-ctx.Done():
			stop()
		case <-done:
		}
	}()
	return stop, nil
}
