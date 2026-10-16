package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
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
	"github.com/CarlvinceTan/polymux/apps/server/internal/fixture"
	"github.com/CarlvinceTan/polymux/apps/server/internal/link"
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

var buildSHA = "unknown"

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
	version := flag.Bool("version", false, "print the build commit and exit")
	listen := flag.String("listen", os.Getenv("POLYMUX_LISTEN"), "authenticated backend IP:port (loopback, private LAN or Tailscale; defaults to 127.0.0.1:7337)")
	dev := flag.Bool("dev", os.Getenv("POLYMUX_DEV") == "1", "development mode (loopback is always allowed)")
	dir := flag.String("data", os.Getenv("POLYMUX_DATA_DIR"), "data directory")
	deviceListen := flag.String("device-listen", "", "TLS device listener (defaults to backend port + 2)")
	noMDNS := flag.Bool("no-mdns", os.Getenv("POLYMUX_NO_MDNS") == "1", "disable Bonjour LAN advertisement")
	tailscale := flag.Bool("tailscale", os.Getenv("POLYMUX_TAILSCALE") == "1", "use Tailscale listeners (requires Tailscale)")
	verify := fixture.Register(flag.CommandLine)
	flag.Parse()
	if *version {
		fmt.Println(buildSHA)
		return nil
	}
	if *verify {
		dataDir, addr, err := fixture.Apply(*dir)
		if err != nil {
			return err
		}
		*dir = dataDir
		*listen = addr
		*dev = true
		fmt.Println(addr)
	}
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
	if _, err := localCredential(ctx, pairings, *dir); err != nil {
		return err
	}
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
	if *verify {
		definitions = fixture.Agents(model)
	} else if path := os.Getenv("POLYMUX_AGENTS"); path != "" {
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
	api, err := server.New(ctx, s, server.Config{
		BuildSHA:    buildSHA,
		MergeRoot:   strings.TrimSpace(os.Getenv("POLYMUX_MERGE_LANE")),
		MergeQueue:  strings.EqualFold(strings.TrimSpace(os.Getenv("POLYMUX_MERGE_QUEUE")), "true"),
		DataDir:     *dir,
		Model:       model,
		Definitions: definitions,
		Factory:     runtime,
		Index:       index,
		Log:         log,
		Push:        sender,
		Devices:     devices,
	})
	if err != nil {
		return err
	}
	defer api.Close()
	if *verify {
		if err := fixture.HoldStream(ctx, s); err != nil {
			return err
		}
	}
	httpServer := &http.Server{Addr: *listen, Handler: api.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	log.Info("Polymux is listening", "address", listener.Addr(), "data", *dir, "model", model)
	done := make(chan error, 2)
	go func() { done <- httpServer.Serve(listener) }()
	go func() { done <- deviceServer.Serve(tls.NewListener(deviceSocket, pairings.TLSConfig())) }()
	if address := deviceSocket.Addr().(*net.TCPAddr); shouldAdvertise(address.IP, *noMDNS) {
		ips := advertisedIPs(address.IP, lanAddrs(), *tailscale)
		if len(ips) == 0 {
			log.Info("Bonjour advertisement skipped: no eligible IP addresses")
		} else {
			stop, err := advertise(ctx, *dir, address.Port, ips)
			if err != nil {
				log.Warn("Bonjour advertisement unavailable", "error", err)
			} else {
				defer stop()
			}
		}
	}
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

func advertise(ctx context.Context, dir string, port int, ips []string) (func(), error) {
	instance, err := os.Hostname()
	if err != nil {
		return nil, fmt.Errorf("bonjour hostname: %w", err)
	}
	identity, err := link.LoadIdentity(dir)
	if err != nil {
		return nil, fmt.Errorf("bonjour identity: %w", err)
	}
	return link.Advertise(ctx, instanceName(instance), port, ips, bonjourTXT(identity.PublicKey))
}

func shouldAdvertise(bind net.IP, noMDNS bool) bool {
	return !noMDNS && !bind.IsLoopback()
}

func advertisedIPs(bind net.IP, addrs []string, tailscale bool) []string {
	if len(bind) != 0 && !bind.IsUnspecified() {
		addrs = []string{bind.String()}
	}
	var ips []string
	for _, address := range addrs {
		ip, err := netip.ParseAddr(address)
		if err != nil {
			continue
		}
		ip = ip.Unmap()
		if ip.Is6() && ip.IsLinkLocalUnicast() || !tailscale && addressRank(ip) == 6 {
			continue
		}
		ips = append(ips, ip.WithZone("").String())
	}
	return ips
}

func bonjourTXT(key []byte) map[string]string {
	fingerprint := sha256.Sum256(key)
	return map[string]string{
		"v": "1",
		"k": base64.RawURLEncoding.EncodeToString(fingerprint[:])[:16],
	}
}

func instanceName(hostname string) string {
	name, _, _ := strings.Cut(strings.TrimSuffix(hostname, ".local"), ".")
	if name == "" {
		return "Polymux"
	}
	return name
}

func defaults(model string) []agentruntime.Definition {
	coding := agentruntime.Definition{Agent: contract.Agent{ID: "coding", Name: "Coding", Role: "Software engineer", Model: model}, Prompt: "You are a pragmatic software engineer. Make focused changes, preserve unrelated work, and verify your results. Reply in natural plain text without Markdown formatting.", Tools: []string{"read", "write", "edit", "bash", "find", "ls"}}
	coding.Workspace = strings.TrimSpace(os.Getenv("POLYMUX_CODING_REPO"))
	return []agentruntime.Definition{
		{Agent: contract.Agent{ID: "assistant", Name: "Assistant", Role: "Personal assistant", Model: model}, Prompt: "You are Polymux, a helpful persistent personal assistant. Write replies as natural plain text without Markdown formatting. Be concise and candid. Tools have the user's OS permissions; use them only when needed to fulfill the user's request.", Tools: []string{"read", "write", "edit", "bash", "find", "ls"}},
		{Agent: contract.Agent{ID: "research", Name: "Research", Role: "Research assistant", Model: model}, Prompt: "You are a careful research assistant. Distinguish verified facts from uncertainty and provide sources when available. Reply in natural plain text without Markdown formatting.", Tools: []string{"read", "bash", "find", "ls"}},
		coding,
	}
}
