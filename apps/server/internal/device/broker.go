package device

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const MaxMessage = 8 << 20

type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}
type Content struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Data     string `json:"data,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
}
type Packet struct {
	Type         string          `json:"type"`
	ID           string          `json:"id,omitempty"`
	Operation    string          `json:"operation,omitempty"`
	Arguments    json.RawMessage `json:"arguments,omitempty"`
	Capabilities []string        `json:"capabilities,omitempty"`
	Tools        []Tool          `json:"tools,omitempty"`
	Content      []Content       `json:"content,omitempty"`
	IsError      bool            `json:"isError,omitempty"`
}

type Status struct {
	Pairing
	Connected bool     `json:"connected"`
	Ready     []string `json:"ready"`
	Tools     []Tool   `json:"tools"`
}

type connection struct {
	pair    Pairing
	token   string
	ws      *websocket.Conn
	write   sync.Mutex
	gate    chan struct{}
	done    chan struct{}
	ready   []string
	tools   []Tool
	pending map[string]chan Packet
}

type Broker struct {
	store       *Store
	limit       Limiter
	events      []Paired
	mu          sync.Mutex
	connections map[string]*connection
	closed      bool
	workers     sync.WaitGroup
}

func New(s *Store) *Broker { return &Broker{store: s, connections: map[string]*connection{}} }

func (b *Broker) Issue(ctx context.Context, name string) (string, error) {
	return b.store.IssueAppToken(ctx, name)
}

func (b *Broker) Close() {
	b.mu.Lock()
	b.closed = true
	for _, c := range b.connections {
		c.ws.Close()
	}
	b.mu.Unlock()
	b.workers.Wait()
}

func (b *Broker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !b.limit.Allow(Caller(r), time.Now()) {
		Reject(w)
		return
	}
	// Control is a separate TLS-only listener; browser origins are never admitted.
	if r.TLS == nil || r.Header.Get("Origin") != "" {
		Reject(w)
		return
	}
	if r.Method == "POST" && (r.URL.Path == "/enroll" || r.URL.Path == "/redeem") {
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		var input struct {
			Code         string   `json:"code"`
			Name         string   `json:"name"`
			Capabilities []string `json:"capabilities"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			Reject(w)
			return
		}
		var p Enrollment
		var err error
		if r.URL.Path == "/redeem" {
			p, err = b.store.enrollApp(r.Context(), Caller(r), input.Code)
		} else {
			p, err = b.store.Enroll(r.Context(), input.Code, input.Name, input.Capabilities)
		}
		if err != nil {
			Reject(w)
			return
		}
		b.mu.Lock()
		b.events = append(b.events, Paired{Type: "device.paired", Pairing: p.Pairing})
		if len(b.events) > 64 {
			b.events = b.events[len(b.events)-64:]
		}
		b.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(p)
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	p, err := b.store.Authenticate(r.Context(), token)
	if err != nil {
		Reject(w)
		return
	}
	if r.Method == "DELETE" && r.URL.Path == "/pairing" {
		if err := b.store.Revoke(r.Context(), p.ID); err != nil {
			http.Error(w, "revocation failed", 500)
			return
		}
		b.mu.Lock()
		if c := b.connections[p.ID]; c != nil {
			c.ws.Close()
		}
		b.mu.Unlock()
		w.WriteHeader(204)
		return
	}
	if r.Method != "GET" || r.URL.Path != "/connect" {
		http.NotFound(w, r)
		return
	}
	ws, err := (&websocket.Upgrader{HandshakeTimeout: 5 * time.Second}).Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &connection{pair: p, token: token, ws: ws, gate: make(chan struct{}, 1), done: make(chan struct{}), pending: map[string]chan Packet{}}
	ws.SetReadLimit(MaxMessage)
	ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	var hello Packet
	if err := ws.ReadJSON(&hello); err != nil || hello.Type != "hello" || !validReady(p, hello) {
		ws.Close()
		return
	}
	c.ready, c.tools = hello.Capabilities, hello.Tools
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		ws.Close()
		return
	}
	// Never replace a live generation and accidentally allow concurrent actions.
	if b.connections[p.ID] != nil {
		b.mu.Unlock()
		ws.Close()
		return
	}
	b.connections[p.ID] = c
	b.workers.Add(1)
	b.mu.Unlock()
	defer func() {
		ws.Close()
		b.mu.Lock()
		delete(b.connections, p.ID)
		close(c.done)
		b.mu.Unlock()
		b.workers.Done()
	}()
	if err := c.send(Packet{Type: "ready"}); err != nil {
		return
	}
	for {
		ws.SetReadDeadline(time.Now().Add(45 * time.Second))
		var packet Packet
		if err := ws.ReadJSON(&packet); err != nil {
			return
		}
		if _, err := b.store.Authenticate(r.Context(), token); err != nil {
			return
		}
		b.mu.Lock()
		switch packet.Type {
		case "hello":
			if !validReady(p, packet) {
				b.mu.Unlock()
				return
			}
			c.ready, c.tools = packet.Capabilities, packet.Tools
		case "result":
			if ch := c.pending[packet.ID]; ch != nil {
				select {
				case ch <- packet:
				default:
				}
			}
		default:
			b.mu.Unlock()
			return
		}
		b.mu.Unlock()
	}
}

func validReady(p Pairing, packet Packet) bool {
	if len(packet.Capabilities) > 2 || len(packet.Tools) > 64 {
		return false
	}
	for _, cap := range packet.Capabilities {
		if !slices.Contains(p.Capabilities, cap) {
			return false
		}
	}
	for _, tool := range packet.Tools {
		if !NativeTool(tool.Name) || len(tool.Description) > 8192 || len(tool.InputSchema) > 32768 || !json.Valid(tool.InputSchema) {
			return false
		}
	}
	return true
}

func (c *connection) send(p Packet) error {
	c.write.Lock()
	defer c.write.Unlock()
	c.ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return c.ws.WriteJSON(p)
}

func (b *Broker) List(ctx context.Context, agent string) ([]Status, error) {
	all, err := b.All(ctx)
	if err != nil {
		return nil, err
	}
	out := []Status{}
	for _, state := range all {
		if state.Agent == agent {
			out = append(out, state)
		}
	}
	return out, nil
}

// All lists every paired device, including devices paired to other agents.
func (b *Broker) All(ctx context.Context) ([]Status, error) {
	pairs, err := b.store.List(ctx)
	if err != nil {
		return nil, err
	}
	out := []Status{}
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, p := range pairs {
		if p.Revoked {
			continue
		}
		state := Status{Pairing: p, Ready: []string{}, Tools: []Tool{}}
		if c := b.connections[p.ID]; c != nil {
			state.Connected = true
			state.Ready = slices.Clone(c.ready)
			state.Tools = slices.Clone(c.tools)
		}
		out = append(out, state)
	}
	return out, nil
}

func (b *Broker) Call(ctx context.Context, agent, id, operation string, args json.RawMessage) (Packet, error) {
	b.mu.Lock()
	c := b.connections[id]
	b.mu.Unlock()
	if c == nil || c.pair.Agent != agent {
		return Packet{}, errors.New("paired device unavailable")
	}
	select {
	case c.gate <- struct{}{}:
	case <-ctx.Done():
		return Packet{}, ctx.Err()
	case <-c.done:
		return Packet{}, errors.New("device disconnected")
	}
	defer func() { <-c.gate }()
	if _, err := b.store.Authenticate(ctx, c.token); err != nil {
		c.ws.Close()
		return Packet{}, err
	}
	capability := "native"
	if operation == "command" {
		capability = "commands"
	} else if !NativeTool(operation) {
		return Packet{}, errors.New("unsupported native operation")
	}
	b.mu.Lock()
	ready := slices.Contains(c.ready, capability)
	known := operation == "command"
	for _, tool := range c.tools {
		known = known || tool.Name == operation
	}
	b.mu.Unlock()
	if !ready || !known || !slices.Contains(c.pair.Capabilities, capability) {
		return Packet{}, errors.New("device capability not ready")
	}
	if len(args) > 64<<10 || !json.Valid(args) {
		return Packet{}, errors.New("invalid device arguments")
	}
	request := Packet{Type: "request", ID: randomID(), Operation: operation, Arguments: args}
	ch := make(chan Packet, 1)
	b.mu.Lock()
	c.pending[request.ID] = ch
	b.mu.Unlock()
	defer func() { b.mu.Lock(); delete(c.pending, request.ID); b.mu.Unlock() }()
	if err := c.send(request); err != nil {
		c.ws.Close()
		return Packet{}, errors.New("device delivery unknown; inspect before retrying")
	}
	select {
	case result := <-ch:
		return result, nil
	case <-c.done:
		return Packet{}, errors.New("device disconnected; completion unknown, do not replay")
	case <-ctx.Done():
		// Closing this generation cancels local work; reconnect never replays it.
		c.ws.Close()
		return Packet{}, errors.New("device call interrupted; completion unknown, inspect before retrying")
	}
}

type Paired struct {
	Type string `json:"type"`
	Pairing
}

// Paired serves the owner on loopback; remote routes cannot read device metadata.
func (b *Broker) Paired(w http.ResponseWriter, r *http.Request) {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() || r.Method != "GET" || r.Header.Get("Origin") != "" {
		Reject(w)
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(b.events)
}
