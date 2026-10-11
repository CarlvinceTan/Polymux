package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/CarlvinceTan/polymux/apps/server/internal/agentruntime"
	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/CarlvinceTan/polymux/apps/server/internal/device"
	"github.com/CarlvinceTan/polymux/apps/server/internal/embedproc"
	"github.com/CarlvinceTan/polymux/apps/server/internal/push"
	"github.com/CarlvinceTan/polymux/apps/server/internal/search"
	"github.com/CarlvinceTan/polymux/apps/server/internal/server"
	"github.com/CarlvinceTan/polymux/apps/server/internal/store"
)

const (
	embedModel     = "google/embeddinggemma-2"
	embedDims      = 512
	extractTimeout = 3 * time.Minute
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "server: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) > 1 && os.Args[1] == "host" {
		return runHost(os.Args[2:])
	}
	if len(os.Args) > 1 && os.Args[1] == "device" {
		return runDevice(os.Args[2:])
	}
	listen := flag.String("listen", os.Getenv("POLYMUX_LISTEN"), "unauthenticated backend IP:port; should stay on loopback (defaults to 127.0.0.1:7337)")
	dev := flag.Bool("dev", os.Getenv("POLYMUX_DEV") == "1", "development mode (loopback is always allowed)")
	dir := flag.String("data", os.Getenv("POLYMUX_DATA_DIR"), "data directory")
	deviceListen := flag.String("device-listen", "", "TLS device listener (defaults to backend port + 2)")
	tailscale := flag.Bool("tailscale", os.Getenv("POLYMUX_TAILSCALE") == "1", "use Tailscale listeners (requires Tailscale)")
	flag.Parse()
	if *dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		*dir = filepath.Join(home, "Library", "Application Support", "Polymux", "server")
	}
	defaultIP, err := listenIP(*tailscale)
	if err != nil {
		return err
	}
	if *listen == "" {
		*listen = net.JoinHostPort(defaultIP, "7337")
	}
	if err := validateListen(*listen, *dev); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	lock, err := lockData(*dir, ".server.lock")
	if err != nil {
		return err
	}
	defer lock.Close()
	s, err := store.Open(ctx, filepath.Join(*dir, "polymux.db"))
	if err != nil {
		return err
	}
	defer s.Close()
	_, port, err := net.SplitHostPort(*listen)
	if err != nil {
		return err
	}
	if *deviceListen == "" {
		n, err := strconv.Atoi(port)
		if err != nil || n > 65533 {
			return errors.New("backend port must allow two adjacent ports")
		}
		address := "0.0.0.0"
		if *tailscale {
			address = defaultIP
		}
		*deviceListen = net.JoinHostPort(address, strconv.Itoa(n+2))
	}
	if err := validateDevice(*deviceListen); err != nil {
		return err
	}
	deviceHost, _, err := net.SplitHostPort(*deviceListen)
	if err != nil {
		return err
	}
	pairings, err := device.Open(ctx, *dir, identityHost(deviceHost))
	if err != nil {
		return err
	}
	defer pairings.Close()
	devices := device.New(pairings)
	defer devices.Close()
	deviceSocket, err := net.Listen("tcp", *deviceListen)
	if err != nil {
		return err
	}
	defer deviceSocket.Close()
	deviceServer := &http.Server{Handler: devices, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 8 << 10}
	defer deviceServer.Close()
	config, err := loadModel(*dir)
	if err != nil {
		return err
	}
	baseURL, model := config.URL, config.Model
	key, err := config.Key()
	if err != nil {
		return err
	}
	storage, closeStorage, err := agentruntime.NewDurableStorage(*dir)
	if err != nil {
		return err
	}
	defer closeStorage()
	runtime, err := agentruntime.NewDurable(ctx, *dir, baseURL, model, key, agentruntime.Client{Headers: config.Headers, Session: config.Session}, storage)
	if err != nil {
		return err
	}
	defer runtime.Close()
	definitions := defaults(model)
	if path := os.Getenv("POLYMUX_AGENTS"); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(data, &definitions); err != nil {
			return err
		}
	}
	seen := map[string]bool{}
	for _, d := range definitions {
		if d.Agent.ID == "" || seen[d.Agent.ID] || strings.ContainsAny(d.Agent.ID, "/\\.") {
			return fmt.Errorf("agent identifiers must be unique path-safe tokens")
		}
		seen[d.Agent.ID] = true
	}
	client := &http.Client{Timeout: 2 * time.Minute}
	index := &search.Index{Store: s, Log: log}
	if bin := os.Getenv("POLYMUX_EXTRACTOR"); bin != "" {
		index.Extractor = &search.SubprocessExtractor{Bin: bin, Timeout: extractTimeout}
	}
	if bin := os.Getenv("POLYMUX_LLAMA"); bin != "" {
		process, err := embedproc.Start(ctx, embedproc.Config{Bin: bin, Model: os.Getenv("POLYMUX_EMBED_MODEL"), Log: log})
		if err != nil {
			return err
		}
		defer process.Close()
		index.Embedder = &search.HTTPEmbedder{URL: process.URL(), Model: embedModel, Dims: embedDims, Client: client}
	} else if url := os.Getenv("POLYMUX_EMBED_URL"); url != "" {
		index.Embedder = &search.HTTPEmbedder{URL: url, Model: embedModel, Dims: embedDims, Client: client}
	}
	if index.Embedder != nil {
		if _, err := s.DB.ExecContext(ctx, `UPDATE messages SET indexing_state='pending' WHERE indexing_state='error'`); err != nil {
			return err
		}
	}
	log.Info("search providers", "semantic", index.Embedder != nil, "extractor", index.Extractor != nil)
	var sender server.PushSender
	if path := os.Getenv("POLYMUX_APNS_KEY_FILE"); path != "" {
		sender, err = push.Open(push.Config{Path: path, KeyID: os.Getenv("POLYMUX_APNS_KEY_ID"), TeamID: os.Getenv("POLYMUX_APNS_TEAM_ID"), Topic: "com.flarehq.polymux.app"})
		if err != nil {
			return err
		}
	}
	api, err := server.New(ctx, s, server.Config{DataDir: *dir, Model: model, Definitions: definitions, Factory: runtime, Index: index, Log: log, Push: sender, Devices: devices})
	if err != nil {
		return err
	}
	defer api.Close()
	httpServer := &http.Server{Addr: *listen, Handler: api, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	log.Info("Polymux is listening", "address", listener.Addr(), "data", *dir, "model", model)
	done := make(chan error, 2)
	go func() { done <- httpServer.Serve(listener) }()
	go func() { done <- deviceServer.Serve(tls.NewListener(deviceSocket, pairings.TLSConfig())) }()
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		end, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(end); err != nil {
			return err
		}
	}
	return nil
}

func defaults(model string) []agentruntime.Definition {
	return []agentruntime.Definition{
		{Agent: contract.Agent{ID: "assistant", Name: "Assistant", Role: "Personal assistant", Model: model}, Prompt: "You are Polymux, a helpful persistent personal assistant. Write replies as natural plain text without Markdown formatting. Be concise and candid. Tools have the user's OS permissions; use them only when needed to fulfill the user's request.", Tools: []string{"read", "write", "edit", "bash", "find", "ls"}},
		{Agent: contract.Agent{ID: "research", Name: "Research", Role: "Research assistant", Model: model}, Prompt: "You are a careful research assistant. Distinguish verified facts from uncertainty and provide sources when available. Reply in natural plain text without Markdown formatting.", Tools: []string{"read", "bash", "find", "ls"}},
		{Agent: contract.Agent{ID: "coding", Name: "Coding", Role: "Software engineer", Model: model}, Prompt: "You are a pragmatic software engineer. Make focused changes, preserve unrelated work, and verify your results. Reply in natural plain text without Markdown formatting.", Tools: []string{"read", "write", "edit", "bash", "find", "ls"}},
	}
}
