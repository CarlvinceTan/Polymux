package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestNetworkDescribesServer(t *testing.T) {
	_, endpoint := startTest(t, &testFactory{})
	response, err := http.Get(endpoint.URL + "/network")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status %d", response.StatusCode)
	}
	var value struct {
		Server struct {
			Name, Build, Platform, Role string
		}
		Devices []any
	}
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}
	if value.Server.Name == "" || value.Server.Role != "server" || value.Server.Platform == "" {
		t.Fatalf("server %+v", value.Server)
	}
	if value.Devices == nil {
		t.Fatal("devices must be an array")
	}
}

func TestNetworkInviteAndExport(t *testing.T) {
	api, endpoint := startTest(t, &testFactory{})
	if err := os.MkdirAll(filepath.Join(api.config.DataDir, "devices"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(api.config.DataDir, "devices", "local-token"), []byte("token"), 0o600); err != nil {
		t.Fatal(err)
	}
	response, err := http.Get(endpoint.URL + "/network/invite")
	if err != nil {
		t.Fatal(err)
	}
	var invite struct{ URL, Token string }
	if err := json.NewDecoder(response.Body).Decode(&invite); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if invite.URL == "" || invite.Token != "token" {
		t.Fatalf("invite %+v", invite)
	}
	response, err = http.Get(endpoint.URL + "/network/export")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("export status %d", response.StatusCode)
	}
	if got := response.Header.Get("X-Polymux-SHA256"); len(got) != 64 {
		t.Fatalf("checksum %q", got)
	}
	magic := make([]byte, 2)
	if _, err := response.Body.Read(magic); err != nil || magic[0] != 0x1f || magic[1] != 0x8b {
		t.Fatalf("gzip magic %v %v", magic, err)
	}
}
