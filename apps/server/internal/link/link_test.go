package link

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func testOffer(t *testing.T, now time.Time) Offer {
	t.Helper()
	key, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	o, err := NewOffer(Identity{PublicKey: key, PrivateKey: private}, []string{"192.168.1.2:7339", "[fe80::1%en0]:7339"}, now)
	if err != nil {
		t.Fatal(err)
	}
	return o
}

func TestOffer(t *testing.T) {
	now := time.Now()
	o := testOffer(t, now)
	p, err := ParseOffer(o.URI())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(o.Issuer, p.Issuer) || o.Secret != p.Secret || !reflect.DeepEqual(o.LAN, p.LAN) || o.Code != p.Code {
		t.Fatal("wire fields did not round trip")
	}
	if !o.Expires.Equal(now.Add(10*time.Minute)) || !p.Expires.IsZero() {
		t.Fatal("wrong expiry semantics")
	}
	if p.URI() != o.URI() {
		t.Fatal("URI did not round trip")
	}
	if !regexp.MustCompile(`^[0-9]{6}$`).MatchString(o.Code) || digits(o.Secret, []byte("polymux-code")) != o.Code {
		t.Fatal("invalid or unstable code")
	}
	if digits([32]byte{}, []byte("polymux-code")) != "989457" {
		t.Fatal("code derivation changed")
	}
}

func TestTamper(t *testing.T) {
	o := testOffer(t, time.Now())
	for _, field := range []string{"v", "k", "s", "n"} {
		t.Run(field, func(t *testing.T) {
			u, _ := url.Parse(o.URI())
			q := u.Query()
			q.Set(field, "bad")
			u.RawQuery = q.Encode()
			if _, err := ParseOffer(u.String()); err == nil {
				t.Fatal("accepted invalid field")
			}
		})
	}
	for _, uri := range []string{strings.Replace(o.URI(), "polymux:", "https:", 1), o.URI() + "&v=1", o.URI() + "#extra", strings.Replace(o.URI(), "//pair?", "//pair/extra?", 1), "polymux://pair?v=1"} {
		if _, err := ParseOffer(uri); err == nil {
			t.Fatalf("accepted %s", uri)
		}
	}
}

func TestSAS(t *testing.T) {
	issuerSeed := make([]byte, ed25519.SeedSize)
	peerSeed := make([]byte, ed25519.SeedSize)
	peerSeed[0] = 1
	o := Offer{Issuer: ed25519.NewKeyFromSeed(issuerSeed).Public().(ed25519.PublicKey)}
	peer := ed25519.NewKeyFromSeed(peerSeed).Public().(ed25519.PublicKey)
	issuerSide := SAS(o.Issuer, peer, o.Secret)
	parsed, err := ParseOffer(o.URI())
	if err != nil {
		t.Fatal(err)
	}
	peerSide := SAS(parsed.Issuer, peer, parsed.Secret)
	if issuerSide != peerSide || !regexp.MustCompile(`^[0-9]{6}$`).MatchString(peerSide) {
		t.Fatal("SAS disagreement")
	}
	if SAS(peer, o.Issuer, o.Secret) == issuerSide {
		t.Fatal("SAS ignored key order")
	}
	other := append(ed25519.PublicKey(nil), peer...)
	other[0] ^= 1
	if SAS(o.Issuer, other, o.Secret) == issuerSide {
		t.Fatal("SAS ignored peer key")
	}
}

func TestPairing(t *testing.T) {
	peer := testOffer(t, time.Now()).Issuer
	p, err := NewPairing(peer)
	if err != nil || p.Role != "client" || !bytes.Equal(p.Peer, peer) {
		t.Fatal("invalid pairing", err)
	}
	peer[0] ^= 1
	if bytes.Equal(p.Peer, peer) {
		t.Fatal("pairing aliases caller key")
	}
	if _, err := NewPairing(nil); err == nil {
		t.Fatal("accepted invalid peer")
	}
}

func TestRedeem(t *testing.T) {
	for _, code := range []bool{false, true} {
		now := time.Now()
		o := testOffer(t, now)
		var r Offers
		r.Add(o)
		credential := base64.RawURLEncoding.EncodeToString(o.Secret[:])
		if code {
			credential = o.Code
		}
		if _, err := r.Redeem(credential, now); err != nil {
			t.Fatal(err)
		}
		r.Add(o)
		if _, err := r.Redeem(credential, now); !errors.Is(err, ErrInvalid) {
			t.Fatal("offer reused", err)
		}
	}
}

func TestExpiry(t *testing.T) {
	now := time.Now()
	o := testOffer(t, now)
	var r Offers
	r.Add(o)
	if _, err := r.Redeem(o.Code, o.Expires); !errors.Is(err, ErrInvalid) {
		t.Fatal("expiry boundary accepted", err)
	}
}

func TestLockout(t *testing.T) {
	now := time.Now()
	o := testOffer(t, now)
	var r Offers
	r.Add(o)
	for i := 0; i < 5; i++ {
		_, err := r.Redeem("invalid", now)
		want := ErrInvalid
		if i == 4 {
			want = ErrLocked
		}
		if !errors.Is(err, want) {
			t.Fatal(i, err)
		}
	}
	if _, err := r.Redeem(o.Code, now.Add(time.Minute)); !errors.Is(err, ErrLocked) {
		t.Fatal("lockout bypass", err)
	}
	secret := base64.RawURLEncoding.EncodeToString(o.Secret[:])
	if _, err := r.Redeem(secret, now.Add(time.Minute)); !errors.Is(err, ErrLocked) {
		t.Fatal("full secret bypassed lockout", err)
	}
	fresh := testOffer(t, now.Add(15*time.Minute))
	r.Add(fresh)
	if _, err := r.Redeem(fresh.Code, now.Add(15*time.Minute)); err != nil {
		t.Fatal("lockout did not end", err)
	}
}

func TestConcurrentRedeem(t *testing.T) {
	now := time.Now()
	o := testOffer(t, now)
	var r Offers
	r.Add(o)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := r.Redeem(o.Code, now); results <- err }()
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatal("wrong redemption count", successes)
	}
}

func TestIdentityCreation(t *testing.T) {
	dir := t.TempDir()
	if err := createIdentity(filepath.Join(dir, "devices", "identity.ed25519")); err != nil {
		t.Fatal(err)
	}
	for path, mode := range map[string]os.FileMode{"devices": 0700, "devices/identity.ed25519": 0600} {
		info, err := os.Stat(filepath.Join(dir, path))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != mode {
			t.Fatal("wrong permissions", info.Mode())
		}
	}
}

func TestZeroClock(t *testing.T) {
	now := time.Now()
	o := testOffer(t, now)
	var r Offers
	r.Add(o)
	if _, err := r.Redeem(o.Code, time.Time{}); !errors.Is(err, ErrInvalid) {
		t.Fatal("accepted zero server clock", err)
	}
	if _, err := r.Redeem(o.Code, now); err != nil {
		t.Fatal("zero clock consumed offer", err)
	}
}

func TestCodeCollision(t *testing.T) {
	now := time.Now()
	var r Offers
	offers := make([]Offer, 2)
	// These fixed secrets both derive code 098376.
	for i, value := range []uint64{366, 426} {
		o := testOffer(t, now)
		o.Secret = [32]byte{}
		binary.BigEndian.PutUint64(o.Secret[24:], value)
		o.Code = digits(o.Secret, []byte("polymux-code"))
		if o.Code != "098376" {
			t.Fatal("collision fixture changed", o.Code)
		}
		offers[i] = o
		r.Add(o)
	}
	if _, err := r.Redeem("098376", now); !errors.Is(err, ErrInvalid) {
		t.Fatal("redeemed ambiguous code", err)
	}
	for _, o := range offers {
		secret := base64.RawURLEncoding.EncodeToString(o.Secret[:])
		got, err := r.Redeem(secret, now)
		if err != nil || got.Secret != o.Secret {
			t.Fatal("ambiguous attempt consumed or changed offer", err)
		}
	}
}

func TestIdentity(t *testing.T) {
	dir := t.TempDir()
	first, err := LoadIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first.PrivateKey, second.PrivateKey) || !bytes.Equal(first.PublicKey, second.PublicKey) {
		t.Fatal("identity changed")
	}
	if err := ResetIdentity(dir); err != nil {
		t.Fatal(err)
	}
	third, err := LoadIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(first.PublicKey, third.PublicKey) {
		t.Fatal("reset retained identity")
	}
	path := filepath.Join(dir, "devices", "identity.ed25519")
	if err := os.WriteFile(path, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadIdentity(dir); err == nil {
		t.Fatal("regenerated corrupt identity")
	}
	data, _ := os.ReadFile(path)
	if string(data) != "corrupt" {
		t.Fatal("modified corrupt identity")
	}
}
