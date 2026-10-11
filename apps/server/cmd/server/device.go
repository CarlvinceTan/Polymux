package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/CarlvinceTan/polymux/apps/server/internal/device"
	"github.com/CarlvinceTan/polymux/apps/server/internal/link"
)

func runDevice(args []string) error {
	if len(args) == 0 || args[0] != "pair" && args[0] != "list" && args[0] != "revoke" {
		return errors.New("usage: polymux-server device pair|list|revoke [-data path] [-url https://IP:7339] [-agent ID] [-capabilities native,commands] [-id ID] [-tailscale]")
	}
	flags := flag.NewFlagSet("device", flag.ContinueOnError)
	dir := flags.String("data", os.Getenv("POLYMUX_DATA_DIR"), "server data directory")
	address := flags.String("url", "", "pinned TLS device listener")
	agent := flags.String("agent", "", "agent authorized to use this device")
	caps := flags.String("capabilities", "native", "native and/or commands")
	id := flags.String("id", "", "device to revoke")
	tailscale := flags.Bool("tailscale", os.Getenv("POLYMUX_TAILSCALE") == "1", "use a Tailscale device URL (requires Tailscale)")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if *dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		*dir = filepath.Join(home, "Library", "Application Support", "Polymux", "server")
	}
	ip := ""
	if *tailscale {
		var err error
		ip, err = tailnet()
		if err != nil {
			return err
		}
	}
	if *address == "" {
		if ip == "" {
			ip = lanHost()
		}
		*address = "https://" + net.JoinHostPort(ip, "7339")
	}
	u, err := url.Parse(*address)
	if err != nil || u.Hostname() == "" {
		return errors.New("invalid device URL")
	}
	ctx := context.Background()
	s, err := device.Open(ctx, *dir, identityHost(u.Hostname()))
	if err != nil {
		return err
	}
	defer s.Close()
	switch args[0] {
	case "pair":
		if *agent == "" {
			return errors.New("choose an existing agent with -agent")
		}
		db, err := sql.Open("sqlite3", "file:"+filepath.Join(*dir, "polymux.db")+"?mode=ro")
		if err != nil {
			return err
		}
		defer db.Close()
		var found string
		if err := db.QueryRowContext(ctx, `SELECT id FROM agents WHERE id=?`, *agent).Scan(&found); err != nil {
			return errors.New("agent not found; start the server and create it first")
		}
		identity, err := link.LoadIdentity(*dir)
		if err != nil {
			return err
		}
		port := u.Port()
		if port == "" {
			port = "7339"
		}
		var lan []string
		for _, ip := range lanAddrs() {
			lan = append(lan, net.JoinHostPort(ip, port))
		}
		offer, err := link.NewOffer(identity, lan, time.Now())
		if err != nil {
			return err
		}
		ticket, err := s.Issue(ctx, *address, *agent, strings.Split(*caps, ","))
		if err != nil {
			return err
		}
		fmt.Println(ticket)
		fmt.Fprintln(os.Stderr, "Expires in 10 minutes, single use. Paste into Polymux Settings > This Mac. Treat it as a temporary credential.")
		fmt.Fprintln(os.Stderr, "Link offer (preview; the app does not redeem it yet):", offer.URI())
		fmt.Fprintln(os.Stderr, "Link offer (preview; the app does not redeem it yet):", offer.Code)
	case "list":
		pairs, err := s.List(ctx)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(pairs)
	case "revoke":
		if *id == "" {
			return errors.New("choose a device with -id")
		}
		if err := s.Revoke(ctx, *id); err != nil {
			return err
		}
		fmt.Println("Device revoked; active connections close on the next heartbeat or call.")
	}
	return nil
}
