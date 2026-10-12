package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/microsoft"
)

// Register this Web redirect on the Microsoft app: <API base>/oauth/microsoft/callback.
const microsoftCallback = "/oauth/microsoft/callback"

type driveAccount struct {
	ID    string        `json:"id"`
	Email string        `json:"email"`
	Token *oauth2.Token `json:"token"`
}
type driveLogin struct {
	Config   oauth2.Config
	Verifier string
	Expires  time.Time
}
type oneDrive struct {
	mu         sync.Mutex
	dir        string
	config     oauth2.Config
	publicBase string
	graph      string
	client     *http.Client
	pending    map[string]driveLogin
	account    *driveAccount
	failure    string
}

func openDrive(dir string) (*oneDrive, error) {
	d := &oneDrive{dir: filepath.Join(dir, "connections", "onedrive"), graph: "https://graph.microsoft.com/v1.0", client: &http.Client{Timeout: 30 * time.Second}, pending: map[string]driveLogin{}, publicBase: os.Getenv("POLYMUX_OAUTH_PUBLIC_BASE")}
	d.config = oauth2.Config{ClientID: os.Getenv("POLYMUX_ONEDRIVE_CLIENT_ID"), ClientSecret: os.Getenv("POLYMUX_ONEDRIVE_CLIENT_SECRET"), Endpoint: microsoft.AzureADEndpoint("common"), Scopes: []string{"offline_access", "User.Read", "Files.Read", "Files.ReadWrite.All"}}
	if d.publicBase != "" {
		u, err := url.Parse(d.publicBase)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
			return nil, errors.New("invalid oauth public base")
		}
	}
	if err := os.MkdirAll(d.dir, 0700); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(d.dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(d.dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		var account driveAccount
		if err := json.Unmarshal(data, &account); err != nil {
			return nil, errors.New("invalid onedrive account file")
		}
		if account.ID == "" || account.Token == nil || account.Token.RefreshToken == "" {
			return nil, errors.New("invalid onedrive credentials")
		}
		d.account = &account
	}
	return d, nil
}
func (d *oneDrive) accountPath(id string) string {
	sum := sha256.Sum256([]byte(id))
	return filepath.Join(d.dir, hex.EncodeToString(sum[:])+".json")
}
func (d *oneDrive) save(account *driveAccount) error {
	data, err := json.Marshal(account)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(d.dir, ".token-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), d.accountPath(account.ID))
}
func (d *oneDrive) disconnect() error {
	if d.account != nil {
		if err := os.Remove(d.accountPath(d.account.ID)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	d.account = nil
	d.pending = map[string]driveLogin{}
	d.failure = ""
	return nil
}
func (s *Server) driveRoutes() {
	s.mux.HandleFunc("GET /connections", s.connections)
	s.mux.HandleFunc("POST /connections/onedrive/connect", s.connectDrive)
	s.mux.HandleFunc("GET "+microsoftCallback, s.driveCallback)
	s.mux.HandleFunc("GET /oauth/microsoft/success", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, "<!doctype html><title>OneDrive connected</title><p>OneDrive connected. You can close this window.</p>")
	})
	s.mux.HandleFunc("DELETE /connections/onedrive", s.deleteDrive)
	s.mux.HandleFunc("GET /connections/onedrive/files", s.driveFiles)
	s.mux.HandleFunc("GET /connections/onedrive/files/{itemId}/content", s.driveContent)
}
func (s *Server) connections(w http.ResponseWriter, r *http.Request) {
	d := s.drive
	d.mu.Lock()
	defer d.mu.Unlock()
	for state, login := range d.pending {
		if time.Now().After(login.Expires) {
			delete(d.pending, state)
		}
	}
	state, email := "disconnected", ""
	if d.config.ClientID == "" {
		state = "unconfigured"
	}
	if len(d.pending) > 0 {
		state = "connecting"
	}
	if d.account != nil {
		state, email = "connected", d.account.Email
	}
	if d.failure != "" {
		state = "error"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]map[string]string{{"id": "onedrive", "state": state, "email": email, "error": d.failure}})
}
func (s *Server) connectDrive(w http.ResponseWriter, r *http.Request) {
	d := s.drive
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.config.ClientID == "" {
		driveError(w, "OneDrive client ID is not configured", http.StatusServiceUnavailable)
		return
	}
	base := strings.TrimRight(d.publicBase, "/")
	if base == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	config := d.config
	config.RedirectURL = base + microsoftCallback
	now := time.Now()
	for state, login := range d.pending {
		if now.After(login.Expires) {
			delete(d.pending, state)
		}
	}
	if len(d.pending) >= 16 {
		driveError(w, "too many pending connections", http.StatusTooManyRequests)
		return
	}
	state, verifier := oauth2.GenerateVerifier(), oauth2.GenerateVerifier()
	d.pending[state] = driveLogin{Config: config, Verifier: verifier, Expires: now.Add(10 * time.Minute)}
	d.failure = ""
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"authorizeUrl": config.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier))})
}
func (s *Server) driveCallback(w http.ResponseWriter, r *http.Request) {
	d := s.drive
	d.mu.Lock()
	defer d.mu.Unlock()
	state := r.URL.Query().Get("state")
	login, ok := d.pending[state]
	delete(d.pending, state)
	if !ok || time.Now().After(login.Expires) {
		driveError(w, "invalid or expired oauth state", http.StatusBadRequest)
		return
	}
	if r.URL.Query().Get("error") != "" || r.URL.Query().Get("code") == "" {
		d.failure = "OneDrive authorization was not completed"
		driveError(w, d.failure, http.StatusBadRequest)
		return
	}
	ctx := context.WithValue(r.Context(), oauth2.HTTPClient, d.client)
	token, err := login.Config.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(login.Verifier))
	if err != nil || token.RefreshToken == "" {
		d.failure = "OneDrive token exchange failed"
		driveError(w, d.failure, http.StatusBadGateway)
		return
	}
	response, err := d.request(r.Context(), token, "/me?$select=id,mail,userPrincipalName")
	if err != nil {
		d.failure = "OneDrive account lookup failed"
		driveError(w, d.failure, http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	var profile struct {
		ID        string `json:"id"`
		Mail      string `json:"mail"`
		Principal string `json:"userPrincipalName"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&profile) != nil || profile.ID == "" {
		driveError(w, "invalid OneDrive account", http.StatusBadGateway)
		return
	}
	if profile.Mail == "" {
		profile.Mail = profile.Principal
	}
	account := &driveAccount{ID: profile.ID, Email: profile.Mail, Token: token}
	if err := d.save(account); err != nil {
		driveError(w, "cannot save OneDrive credentials", http.StatusInternalServerError)
		return
	}
	if d.account != nil && d.account.ID != account.ID {
		if err := os.Remove(d.accountPath(d.account.ID)); err != nil && !errors.Is(err, os.ErrNotExist) {
			os.Remove(d.accountPath(account.ID))
			driveError(w, "cannot replace OneDrive account", 500)
			return
		}
	}
	d.account = account
	d.failure = ""
	http.Redirect(w, r, "/oauth/microsoft/success", http.StatusSeeOther)
}
func (s *Server) deleteDrive(w http.ResponseWriter, r *http.Request) {
	d := s.drive
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := d.disconnect(); err != nil {
		driveError(w, "cannot remove OneDrive credentials", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	io.WriteString(w, "{}\n")
}
func (d *oneDrive) request(ctx context.Context, token *oauth2.Token, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.graph+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	// Graph content redirects carry a preauthenticated URL; never forward the bearer token.
	client := *d.client
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		req.Header.Del("Authorization")
		if len(via) >= 10 {
			return errors.New("too many redirects")
		}
		return nil
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, errors.New("onedrive request failed")
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("onedrive returned status %d", response.StatusCode)
	}
	return response, nil
}
func (d *oneDrive) fetch(ctx context.Context, path string) (*http.Response, error) {
	if d.account == nil {
		return nil, errors.New("OneDrive is disconnected")
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, d.client)
	token, err := d.config.TokenSource(ctx, d.account.Token).Token()
	if err != nil {
		return nil, errors.New("OneDrive token refresh failed")
	}
	if token.AccessToken != d.account.Token.AccessToken || token.RefreshToken != d.account.Token.RefreshToken || !token.Expiry.Equal(d.account.Token.Expiry) {
		account := *d.account
		account.Token = token
		if err := d.save(&account); err != nil {
			return nil, errors.New("cannot save OneDrive credentials")
		}
		d.account = &account
	}
	return d.request(ctx, token, path)
}
func (s *Server) driveFiles(w http.ResponseWriter, r *http.Request) {
	path := "/me/drive/root/children"
	if folder := strings.Trim(r.URL.Query().Get("path"), "/"); folder != "" {
		parts := strings.Split(folder, "/")
		for i, part := range parts {
			if part == "." || part == ".." {
				driveError(w, "invalid drive path", http.StatusBadRequest)
				return
			}
			parts[i] = url.PathEscape(part)
		}
		path = "/me/drive/root:/" + strings.Join(parts, "/") + ":/children"
	}
	s.serveDrive(w, r, path, true)
}
func (s *Server) driveContent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("itemId")
	if strings.ContainsAny(id, "/\\") || id == "." || id == ".." {
		driveError(w, "invalid item id", 400)
		return
	}
	s.serveDrive(w, r, "/me/drive/items/"+url.PathEscape(id)+"/content", false)
}
func (s *Server) serveDrive(w http.ResponseWriter, r *http.Request, path string, isJSON bool) {
	d := s.drive
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.account == nil {
		driveError(w, "OneDrive is disconnected", http.StatusConflict)
		return
	}
	response, err := d.fetch(r.Context(), path)
	if err != nil {
		d.failure = err.Error()
		driveError(w, d.failure, http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	d.failure = ""
	limit := int64(16 << 20)
	if isJSON {
		limit = 4 << 20
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(data)) > limit {
		driveError(w, "OneDrive response exceeds read limit or failed", http.StatusBadGateway)
		return
	}
	contentType := "application/octet-stream"
	if isJSON {
		contentType = "application/json"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Write(data)
}

func driveError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
