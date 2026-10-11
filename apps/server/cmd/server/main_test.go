package main

import "testing"

func TestNetworkBoundary(t *testing.T) {
	for _, test := range []struct {
		address      string
		dev, allowed bool
	}{{"100.127.193.111:7337", false, true}, {"[fd7a:115c:a1e0::1]:7337", false, true}, {"0.0.0.0:7337", true, false}, {":7337", true, false}, {"192.168.1.2:7337", true, false}, {"127.0.0.1:7337", false, false}, {"127.0.0.1:7337", true, true}} {
		err := validateListen(test.address, test.dev)
		if (err == nil) != test.allowed {
			t.Errorf("listen %s dev=%v: %v", test.address, test.dev, err)
		}
	}
}
