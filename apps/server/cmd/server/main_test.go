package main

import (
	"flag"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNetworkBoundary(t *testing.T) {
	for _, test := range []struct {
		address string
		allowed bool
		device  bool
	}{
		{address: "100.127.193.111:7337", allowed: true},
		{address: "[fd7a:115c:a1e0::1]:7337", allowed: true},
		{address: "0.0.0.0:7337"},
		{address: ":7337"},
		{address: "192.168.1.5:7337", allowed: true},
		{address: "10.0.0.1:7337", allowed: true},
		{address: "172.16.0.1:7337", allowed: true},
		{address: "127.0.0.1:7337", allowed: true},
		{address: "[::1]:7337", allowed: true},
		{address: "8.8.8.8:7337"},
		{address: "[2001:4860:4860::8888]:7337"},
		{address: "[fd00::1]:7339", allowed: true, device: true},
		{address: "[fe80::1%en0]:7339", allowed: true, device: true},
		{address: "0.0.0.0:7339", allowed: true, device: true},
		{address: "[::]:7339", allowed: true, device: true},
		{address: "192.168.1.5:7339", allowed: true, device: true},
		{address: "100.64.0.1:7339", allowed: true, device: true},
		{address: "8.8.8.8:7339", device: true},
		{address: "[fc00::1]:7339", allowed: true, device: true},
		{address: "[::ffff:8.8.8.8]:7339", device: true},
	} {
		t.Run(test.address, func(t *testing.T) {
			for _, dev := range []bool{false, true} {
				err := validateListen(test.address, dev)
				if test.device {
					err = validateDevice(test.address)
				}
				if (err == nil) != test.allowed {
					t.Errorf("dev=%v: %v", dev, err)
				}
			}
		})
	}
}

func TestLANAddrs(t *testing.T) {
	addrs := lanAddrs()
	for i := 1; i < len(addrs); i++ {
		if addressRank(netip.MustParseAddr(addrs[i-1])) > addressRank(netip.MustParseAddr(addrs[i])) {
			t.Fatal("LAN addresses are not ranked")
		}
	}
	for _, address := range addrs {
		ip, err := netip.ParseAddr(address)
		if err != nil || ip.IsLoopback() || !privateIP(ip) {
			t.Errorf("invalid LAN address %q", address)
		}
	}
}

func TestListenerDefaults(t *testing.T) {
	ip, err := listenIP(false)
	if err != nil || ip != "127.0.0.1" {
		t.Fatalf("default listener IP = %q, %v", ip, err)
	}
	if err := validateDevice("0.0.0.0:7339"); err != nil {
		t.Fatal(err)
	}
	if host := identityHost("0.0.0.0"); host != identityHost(lanHost()) {
		t.Fatalf("identity host = %q", host)
	}
	if got := identityHost("fe80::1%en0"); got != "fe80::1" {
		t.Fatalf("identity zone was retained: %q", got)
	}
}

func TestTailscaleAbsent(t *testing.T) {
	addrs := []net.Addr{
		&net.IPNet{IP: net.ParseIP("127.0.0.1"), Mask: net.CIDRMask(8, 32)},
		&net.IPNet{IP: net.ParseIP("192.168.1.5"), Mask: net.CIDRMask(24, 32)},
	}
	if _, err := tailnetAddr(addrs); err == nil || !strings.Contains(err.Error(), "no Tailscale interface found") {
		t.Fatalf("missing Tailscale error = %v", err)
	}
}

func TestTailscalePresent(t *testing.T) {
	addrs := []net.Addr{&net.IPNet{IP: net.ParseIP("100.64.0.5"), Mask: net.CIDRMask(32, 32)}}
	if ip, err := tailnetAddr(addrs); err != nil || ip != "100.64.0.5" {
		t.Fatalf("Tailscale IP = %q, %v", ip, err)
	}
}

func TestTailscaleCommands(t *testing.T) {
	previous := interfaceAddrs
	interfaceAddrs = func() ([]net.Addr, error) { return []net.Addr{}, nil }
	t.Cleanup(func() { interfaceAddrs = previous })
	t.Setenv("POLYMUX_TAILSCALE", "0")
	t.Setenv("POLYMUX_LISTEN", "")
	for _, command := range []string{"run", "host", "device"} {
		t.Run(command, func(t *testing.T) {
			dir := t.TempDir()
			invoke := func(tailscale bool) error {
				args := []string{"-data", dir}
				if tailscale {
					args = append(args, "-tailscale")
				}
				switch command {
				case "host":
					return runHost(append([]string{"run"}, append(args, "-listen", "8.8.8.8:7337")...))
				case "device":
					return runDevice(append([]string{"list"}, args...))
				default:
					oldArgs, oldFlags := os.Args, flag.CommandLine
					defer func() { os.Args, flag.CommandLine = oldArgs, oldFlags }()
					os.Args = append([]string{"polymux-server"}, args...)
					flag.CommandLine = flag.NewFlagSet("server", flag.ContinueOnError)
					return run()
				}
			}
			err := invoke(true)
			if err == nil || !strings.Contains(err.Error(), "no Tailscale interface found") {
				t.Fatalf("-tailscale error = %v", err)
			}
			t.Setenv("POLYMUX_TAILSCALE", "1")
			err = invoke(false)
			if err == nil || !strings.Contains(err.Error(), "no Tailscale interface found") {
				t.Fatalf("POLYMUX_TAILSCALE=1 error = %v", err)
			}
			t.Setenv("POLYMUX_TAILSCALE", "0")
			if command == "run" {
				// Stop after listener selection, before startup can reach external services.
				dir = filepath.Join(dir, "blocked")
				if err := os.WriteFile(dir, []byte("blocked"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			err = invoke(false)
			if err != nil && strings.Contains(err.Error(), "no Tailscale interface found") {
				t.Fatalf("default still requires Tailscale: %v", err)
			}
			if command == "device" && err != nil {
				t.Fatal(err)
			}
			if command == "run" && err == nil {
				t.Fatal("expected startup to stop at blocked data directory")
			}
		})
	}
}
