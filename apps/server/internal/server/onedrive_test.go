package server

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"golang.org/x/oauth2"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestOneDriveOAuthRefresh(t *testing.T) {
	dir := t.TempDir()
	var verifier, redirect string
	refreshes := 0
	download := newDriveEndpoint(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("download received token")
		}
		io.WriteString(w, "hello drive")
	}))
	defer download.Close()
	upstream := newDriveEndpoint(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			r.ParseForm()
			w.Header().Set("Content-Type", "application/json")
			if r.Form.Get("client_secret") != "secret" {
				t.Error("missing client secret")
			}
			if r.Form.Get("grant_type") == "authorization_code" {
				verifier = r.Form.Get("code_verifier")
				if verifier == "" || r.Form.Get("redirect_uri") != redirect {
					t.Error("invalid exchange")
				}
				io.WriteString(w, `{"access_token":"initial","refresh_token":"refresh-one","token_type":"Bearer","expires_in":3600}`)
			} else {
				refreshes++
				if r.Form.Get("refresh_token") != "refresh-one" {
					t.Error("wrong refresh")
				}
				io.WriteString(w, `{"access_token":"renewed","refresh_token":"refresh-two","token_type":"Bearer","expires_in":3600}`)
			}
		case "/me":
			io.WriteString(w, `{"id":"account-1","mail":"user@example.com"}`)
		case "/me/drive/root/children", "/me/drive/root:/My Folder:/children":
			if r.Header.Get("Authorization") != "Bearer renewed" {
				t.Error("wrong graph token")
			}
			io.WriteString(w, `{"value":[{"id":"item-1","name":"hello.txt"}]}`)
		case "/me/drive/items/item-1/content":
			http.Redirect(w, r, download.URL+"/download", 302)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	d, err := openDrive(dir)
	if err != nil {
		t.Fatal(err)
	}
	d.config = oauth2.Config{ClientID: "client", ClientSecret: "secret", Scopes: []string{"offline_access", "User.Read", "Files.Read", "Files.ReadWrite.All"}, Endpoint: oauth2.Endpoint{AuthURL: upstream.URL + "/authorize", TokenURL: upstream.URL + "/token", AuthStyle: oauth2.AuthStyleInParams}}
	d.graph = upstream.URL
	d.client = &http.Client{Transport: driveTransport{upstream: upstream, download: download}}
	s := &Server{drive: d, mux: http.NewServeMux()}
	s.driveRoutes()
	request := func(method, path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest(method, "http://api.example"+path, nil))
		return w
	}
	w := request("POST", "/connections/onedrive/connect")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var auth map[string]string
	json.Unmarshal(w.Body.Bytes(), &auth)
	u, err := url.Parse(auth["authorizeUrl"])
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	redirect = q.Get("redirect_uri")
	if redirect != "http://api.example/oauth/microsoft/callback" || q.Get("response_type") != "code" || q.Get("client_id") != "client" || q.Get("code_challenge_method") != "S256" || q.Get("state") == "" || q.Get("scope") != "offline_access User.Read Files.Read Files.ReadWrite.All" {
		t.Fatalf("invalid authorize query: %v", q)
	}
	callback := microsoftCallback + "?code=code&state=" + url.QueryEscape(q.Get("state"))
	if w := request("GET", callback); w.Code != 303 {
		t.Fatalf("callback: %d %s", w.Code, w.Body.String())
	}
	sum := sha256.Sum256([]byte(verifier))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != q.Get("code_challenge") {
		t.Fatal("PKCE mismatch")
	}
	info, err := os.Stat(d.accountPath("account-1"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("credential permissions: %v %v", info, err)
	}
	if request("GET", callback).Code != 400 {
		t.Fatal("replayed callback")
	}
	d.account.Token.Expiry = time.Now().Add(-time.Hour)
	for _, path := range []string{"/connections/onedrive/files", "/connections/onedrive/files?path=My%20Folder"} {
		w := request("GET", path)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "hello.txt") {
			t.Fatalf("files: %d %s", w.Code, w.Body.String())
		}
	}
	if refreshes != 1 {
		t.Fatalf("refresh count %d", refreshes)
	}
	w = request("GET", "/connections/onedrive/files/item-1/content")
	if w.Code != 200 || w.Body.String() != "hello drive" {
		t.Fatalf("content: %d %s", w.Code, w.Body.String())
	}
	restored, err := openDrive(dir)
	if err != nil {
		t.Fatal(err)
	}
	if restored.account.Token.RefreshToken != "refresh-two" {
		t.Fatal("rotation not persisted")
	}
	w = request("GET", "/connections")
	if !strings.Contains(w.Body.String(), "user@example.com") || strings.Contains(w.Body.String(), "refresh-two") {
		t.Fatal("wrong inventory")
	}
	if request("DELETE", "/connections/onedrive").Code != 200 {
		t.Fatal("disconnect failed")
	}
	if _, err := os.Stat(d.accountPath("account-1")); !os.IsNotExist(err) {
		t.Fatal("credentials remain")
	}
	if request("GET", "/connections/onedrive/files").Code != 409 {
		t.Fatal("disconnected read")
	}
}

func TestOneDriveOAuthFailures(t *testing.T) {
	for _, test := range []struct {
		name, query string
		expired     bool
	}{{"unknown state", "state=unknown", false}, {"expired state", "state=known&code=code", true}, {"denied consent", "state=known&error=access_denied", false}} {
		t.Run(test.name, func(t *testing.T) {
			d, err := openDrive(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			expires := time.Now().Add(time.Minute)
			if test.expired {
				expires = time.Now().Add(-time.Minute)
			}
			d.pending["known"] = driveLogin{Expires: expires}
			s := &Server{drive: d, mux: http.NewServeMux()}
			s.driveRoutes()
			w := httptest.NewRecorder()
			s.ServeHTTP(w, httptest.NewRequest("GET", microsoftCallback+"?"+test.query, nil))
			if w.Code != 400 || d.account != nil {
				t.Fatalf("callback status %d", w.Code)
			}
		})
	}
}

// Exercise HTTP requests and redirects without opening sockets.
type driveEndpoint struct {
	URL     string
	handler http.Handler
}

func newDriveEndpoint(handler http.Handler) *driveEndpoint {
	return &driveEndpoint{URL: "http://fake.example", handler: handler}
}
func (*driveEndpoint) Close() {}

type driveTransport struct{ upstream, download *driveEndpoint }

func (tr driveTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	w := httptest.NewRecorder()
	if r.URL.Path == "/download" {
		tr.download.handler.ServeHTTP(w, r)
	} else {
		tr.upstream.handler.ServeHTTP(w, r)
	}
	return w.Result(), nil
}

func TestOneDriveRefreshFailure(t *testing.T) {
	d, err := openDrive(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	upstream := newDriveEndpoint(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		io.WriteString(w, `{"error":"invalid_grant","error_description":"sensitive-token"}`)
	}))
	d.client = &http.Client{Transport: driveTransport{upstream: upstream}}
	d.config.Endpoint = oauth2.Endpoint{TokenURL: upstream.URL + "/token", AuthStyle: oauth2.AuthStyleInParams}
	d.account = &driveAccount{ID: "test", Token: &oauth2.Token{AccessToken: "expired", RefreshToken: "refresh", Expiry: time.Now().Add(-time.Hour)}}
	s := &Server{drive: d, mux: http.NewServeMux()}
	s.driveRoutes()
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("GET", "/connections/onedrive/files", nil))
	if w.Code != 502 || strings.Contains(w.Body.String(), "sensitive-token") || d.failure != "OneDrive token refresh failed" {
		t.Fatalf("unsafe refresh error: %d %s", w.Code, w.Body.String())
	}
}
