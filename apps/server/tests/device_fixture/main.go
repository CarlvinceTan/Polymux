package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/CarlvinceTan/polymux/apps/server/internal/device"
)

func main() {
	dir := flag.String("data", "", "isolated fixture directory")
	flag.Parse()
	if *dir == "" {
		panic("fixture directory is required")
	}
	ctx := context.Background()
	s, err := device.Open(ctx, *dir, "127.0.0.1")
	if err != nil {
		panic(err)
	}
	defer s.Close()
	b := device.New(s)
	defer b.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	server := &http.Server{Handler: b, ReadHeaderTimeout: 5 * time.Second}
	defer server.Close()
	go server.Serve(tls.NewListener(listener, s.TLSConfig()))
	url := "https://" + listener.Addr().String()
	ticket, err := s.Issue(ctx, url, "assistant", []string{"commands"})
	if err != nil {
		panic(err)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.Encode(map[string]string{"ticket": ticket})
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var input struct {
			Device    string          `json:"device"`
			Operation string          `json:"operation"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &input); err != nil {
			panic(err)
		}
		call, cancel := context.WithTimeout(ctx, 5*time.Second)
		result, err := b.Call(call, "assistant", input.Device, input.Operation, input.Arguments)
		cancel()
		if err != nil {
			encoder.Encode(map[string]string{"error": err.Error()})
		} else {
			encoder.Encode(result)
		}
	}
}
