package link

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/flynn/noise"
	"golang.org/x/crypto/blake2s"
)

func noiseKey(t *testing.T) noise.DHKey {
	t.Helper()
	k, err := noise.DH25519.GenerateKeypair(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func noisePipe(t *testing.T) (net.Conn, net.Conn) {
	t.Helper()
	a, b := net.Pipe()
	t.Cleanup(func() { a.Close(); b.Close() })
	deadline := time.Now().Add(5 * time.Second)
	if err := a.SetDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	if err := b.SetDeadline(deadline); err != nil {
		t.Fatal(err)
	}
	return a, b
}

type noiseResult struct {
	session *Session
	peer    []byte
	err     error
}

func pairedPipe(t *testing.T) (*Session, *Session, net.Conn) {
	t.Helper()
	a, b := noisePipe(t)
	ka, kb := noiseKey(t), noiseKey(t)
	secret := bytes.Repeat([]byte{42}, 32)
	result := make(chan noiseResult, 1)
	go func() { s, p, e := PairServer(b, kb, secret); result <- noiseResult{s, p, e} }()
	client, peer, err := PairClient(a, ka, secret)
	if err != nil {
		t.Fatal(err)
	}
	server := <-result
	if server.err != nil {
		t.Fatal(server.err)
	}
	if !bytes.Equal(peer, kb.Public) || !bytes.Equal(server.peer, ka.Public) {
		t.Fatal("wrong peer static")
	}
	return client, server.session, a
}

func exchange(t *testing.T, from, to *Session, data []byte) {
	t.Helper()
	result := make(chan error, 1)
	go func() {
		n, err := from.Write(data)
		if err == nil && n != len(data) {
			err = io.ErrShortWrite
		}
		result <- err
	}()
	got := make([]byte, len(data))
	// Exercise buffering when callers read less than a frame.
	for offset := 0; offset < len(got); {
		n, err := to.Read(got[offset:min(offset+123, len(got))])
		if err != nil {
			t.Fatal(err)
		}
		offset += n
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, data) {
		t.Fatal("plaintext mismatch")
	}
}

func TestNoisePair(t *testing.T) {
	client, server, _ := pairedPipe(t)
	exchange(t, client, server, bytes.Repeat([]byte{7}, plainLimit))
	exchange(t, client, server, []byte("client to server"))
	exchange(t, server, client, []byte("server to client"))
	exchange(t, client, server, bytes.Repeat([]byte("large"), 40000))
}

func TestNoiseWrongPSK(t *testing.T) {
	a, b := noisePipe(t)
	ka, kb := noiseKey(t), noiseKey(t)
	result := make(chan error, 1)
	go func() { _, _, err := PairServer(b, kb, bytes.Repeat([]byte{1}, 32)); result <- err }()
	client, _, err := PairClient(a, ka, bytes.Repeat([]byte{2}, 32))
	if client != nil {
		t.Fatal("wrong secret returned a session")
	}
	if err == nil {
		t.Fatal("wrong secret accepted by client")
	}
	if err := <-result; err == nil {
		t.Fatal("wrong secret accepted by server")
	}
}

func TestNoiseIK(t *testing.T) {
	for _, paired := range []bool{true, false} {
		t.Run(map[bool]string{true: "paired", false: "unpaired"}[paired], func(t *testing.T) {
			a, b := noisePipe(t)
			ka, kb := noiseKey(t), noiseKey(t)
			result := make(chan noiseResult, 1)
			go func() {
				s, e := Accept(b, kb, func(pub []byte) bool { return paired && bytes.Equal(pub, ka.Public) })
				result <- noiseResult{session: s, err: e}
			}()
			client, err := Dial(a, ka, kb.Public)
			server := <-result
			if !paired {
				if err == nil || server.err == nil {
					t.Fatal("unpaired peer accepted")
				}
				return
			}
			if err != nil || server.err != nil {
				t.Fatalf("client %v server %v", err, server.err)
			}
			exchange(t, client, server.session, []byte("IK client"))
			exchange(t, server.session, client, []byte("IK server"))
		})
	}
}

func TestNoiseTamper(t *testing.T) {
	client, server, raw := pairedPipe(t)
	ciphertext, err := client.tx.Encrypt(nil, nil, []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[len(ciphertext)-1] ^= 1
	result := make(chan error, 1)
	go func() { result <- writeFrame(raw, ciphertext) }()
	if n, err := server.Read(make([]byte, 20)); n != 0 || err == nil {
		t.Fatal("tampering accepted")
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if _, err := server.Read(make([]byte, 20)); err == nil {
		t.Fatal("failed session reused")
	}
}

func TestNoiseIdentity(t *testing.T) {
	dir := t.TempDir()
	a, err := LoadIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := LoadIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a.Noise.Private, b.Noise.Private) || !bytes.Equal(a.Noise.Public, b.Noise.Public) {
		t.Fatal("noise identity changed")
	}
	if bytes.Equal(a.Noise.Private, a.PrivateKey.Seed()) {
		t.Fatal("noise key reused identity seed")
	}
	path := filepath.Join(dir, "devices", "noise.x25519")
	stat, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if stat.Mode().Perm() != 0600 {
		t.Fatal("wrong key permissions")
	}
	if err := os.WriteFile(path, []byte("bad"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadIdentity(dir); err == nil {
		t.Fatal("corrupt noise key accepted")
	}
}

type noiseVector struct {
	Protocol         string   `json:"protocol"`
	Prologue         string   `json:"prologue"`
	InitiatorPrivate string   `json:"initiator_private"`
	InitiatorPublic  string   `json:"initiator_public"`
	ResponderPrivate string   `json:"responder_private"`
	ResponderPublic  string   `json:"responder_public"`
	PSK              string   `json:"psk"`
	RandomSeed       string   `json:"random_seed"`
	Messages         []string `json:"messages"`
	ResponderSeed    string   `json:"responder_seed"`
	TransportPlain   string   `json:"transport_plain"`
	TransportFrame   string   `json:"transport_frame"`
}

func TestNoiseVectors(t *testing.T) {
	data, err := os.ReadFile("testdata/noise_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []noiseVector
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	if len(vectors) != 2 {
		t.Fatal("expected XXpsk3 and IK vectors")
	}
	decode := func(s string) []byte {
		b, e := hex.DecodeString(s)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	for _, v := range vectors {
		t.Run(v.Protocol, func(t *testing.T) {
			pattern := noise.HandshakeXX
			if v.Protocol == "Noise_IK_25519_ChaChaPoly_BLAKE2s" {
				pattern = noise.HandshakeIK
			}
			static, err := noise.DH25519.GenerateKeypair(bytes.NewReader(decode(v.InitiatorPrivate)))
			if err != nil {
				t.Fatal(err)
			}
			responder, err := noise.DH25519.GenerateKeypair(bytes.NewReader(decode(v.ResponderPrivate)))
			if err != nil {
				t.Fatal(err)
			}
			if hex.EncodeToString(static.Public) != v.InitiatorPublic || hex.EncodeToString(responder.Public) != v.ResponderPublic {
				t.Fatal("static vector mismatch")
			}
			cfg := noiseConfig(static, true, pattern)
			if v.Prologue != noisePrologue {
				t.Fatal("prologue mismatch")
			}
			cfg.Random = bytes.NewReader(decode(v.RandomSeed))
			if pattern.Name == "XX" {
				cfg.PresharedKey = decode(v.PSK)
				cfg.PresharedKeyPlacement = 3
			} else {
				cfg.PeerStatic = responder.Public
			}
			hs, err := noise.NewHandshakeState(cfg)
			if err != nil {
				t.Fatal(err)
			}
			rcfg := noiseConfig(responder, false, pattern)
			rcfg.Random = bytes.NewReader(decode(v.ResponderSeed))
			rcfg.PresharedKey = cfg.PresharedKey
			rcfg.PresharedKeyPlacement = cfg.PresharedKeyPlacement
			rhs, err := noise.NewHandshakeState(rcfg)
			if err != nil {
				t.Fatal(err)
			}
			// The initial binding hashes the protocol name followed by the prologue.
			nameHash := blake2s.Sum256([]byte(v.Protocol))
			binding := blake2s.Sum256(append(nameHash[:], []byte(v.Prologue)...))
			if pattern.Name == "IK" {
				binding = blake2s.Sum256(append(binding[:], responder.Public...))
			}
			if !bytes.Equal(hs.ChannelBinding(), binding[:]) {
				t.Fatalf("handshake protocol is not %s", v.Protocol)
			}
			if len(v.Messages) != len(pattern.Messages) {
				t.Fatal("incomplete handshake vector")
			}
			var tx, rx *noise.CipherState
			for i, expected := range v.Messages {
				writer, reader := hs, rhs
				if i%2 != 0 {
					writer, reader = rhs, hs
				}
				msg, first, _, err := writer.WriteMessage(nil, nil)
				if err != nil {
					t.Fatal(err)
				}
				if hex.EncodeToString(msg) != expected {
					t.Fatalf("message %d: %x", i+1, msg)
				}
				_, received, _, err := reader.ReadMessage(nil, msg)
				if err != nil {
					t.Fatal(err)
				}
				if first != nil {
					if i%2 == 0 {
						tx, rx = first, received
					} else {
						tx, rx = received, first
					}
				}
			}
			if !bytes.Equal(hs.ChannelBinding(), rhs.ChannelBinding()) {
				t.Fatal("binding mismatch")
			}
			msg, err := tx.Encrypt(nil, nil, decode(v.TransportPlain))
			if err != nil {
				t.Fatal(err)
			}
			var frame bytes.Buffer
			if err := writeFrame(&frame, msg); err != nil {
				t.Fatal(err)
			}
			if hex.EncodeToString(frame.Bytes()) != v.TransportFrame {
				t.Fatalf("transport frame: %x", frame.Bytes())
			}
			got, err := rx.Decrypt(nil, nil, msg)
			if err != nil || !bytes.Equal(got, decode(v.TransportPlain)) {
				t.Fatalf("transport: %x, %v", got, err)
			}

		})
	}
}

func TestNoiseFreshKeys(t *testing.T) {
	ka, kb := noiseKey(t), noiseKey(t)
	var prior [32]byte
	for i := 0; i < 2; i++ {
		a, b := noisePipe(t)
		result := make(chan noiseResult, 1)
		go func() {
			s, e := Accept(b, kb, func(pub []byte) bool { return bytes.Equal(pub, ka.Public) })
			result <- noiseResult{session: s, err: e}
		}()
		client, err := Dial(a, ka, kb.Public)
		if err != nil {
			t.Fatal(err)
		}
		server := <-result
		if server.err != nil {
			t.Fatal(server.err)
		}
		key := client.tx.UnsafeKey()
		if i > 0 && key == prior {
			t.Fatal("session reused transport key")
		}
		prior = key
	}
}

func TestNoiseReject(t *testing.T) {
	for _, name := range []string{"wrong static", "prologue"} {
		t.Run(name, func(t *testing.T) {
			a, b := noisePipe(t)
			ka, kb := noiseKey(t), noiseKey(t)
			result := make(chan error, 1)
			go func() {
				cfg := noiseConfig(kb, false, noise.HandshakeIK)
				if name == "prologue" {
					cfg.Prologue = []byte("other/1")
				}
				_, _, err := handshake(b, cfg, func([]byte) bool { return true })
				result <- err
			}()
			peer := kb.Public
			if name == "wrong static" {
				peer = noiseKey(t).Public
			}
			s, err := Dial(a, ka, peer)
			if err == nil || s != nil {
				t.Fatal("invalid peer accepted")
			}
			if err := <-result; err == nil {
				t.Fatal("invalid handshake accepted")
			}
		})
	}
}

func TestNoiseNilPaired(t *testing.T) {
	a, _ := noisePipe(t)
	if s, err := Accept(a, noiseKey(t), nil); s != nil || err == nil {
		t.Fatal("nil pairing check accepted")
	}
}

func TestNoiseConfirmation(t *testing.T) {
	a, b := noisePipe(t)
	ka, kb := noiseKey(t), noiseKey(t)
	secret := bytes.Repeat([]byte{42}, 32)
	result := make(chan error, 1)
	go func() {
		cfg := noiseConfig(kb, false, noise.HandshakeXX)
		cfg.PresharedKey, cfg.PresharedKeyPlacement = secret, 3
		s, _, err := handshake(b, cfg, nil)
		if err == nil {
			_, err = s.Write([]byte{2})
		}
		result <- err
	}()
	s, _, err := PairClient(a, ka, secret)
	if s != nil || err == nil || !strings.Contains(err.Error(), "invalid noise confirmation") {
		t.Fatalf("confirmation: %v", err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestNoiseTruncated(t *testing.T) {
	if _, err := readFrame(bytes.NewReader([]byte{0})); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("prefix: %v", err)
	}
	_, server, raw := pairedPipe(t)
	result := make(chan error, 1)
	go func() { _, err := raw.Write([]byte{0}); raw.Close(); result <- err }()
	if n, err := server.Read(make([]byte, 1)); n != 0 || !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("session prefix: %d, %v", n, err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestNoiseReset(t *testing.T) {
	dir := t.TempDir()
	old, err := LoadIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "devices", "noise.x25519")
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadIdentity(dir); err != nil {
		t.Fatal(err)
	}
	stat, err := os.Stat(path)
	if err != nil || stat.Mode().Perm() != 0600 {
		t.Fatalf("permissions: %v, %v", stat, err)
	}
	if err := ResetIdentity(dir); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"identity.ed25519", "noise.x25519"} {
		if _, err := os.Stat(filepath.Join(dir, "devices", name)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("reset %s: %v", name, err)
		}
	}
	if err := ResetIdentity(dir); err != nil {
		t.Fatal(err)
	}
	fresh, err := LoadIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(old.Noise.Public, fresh.Noise.Public) || bytes.Equal(old.PublicKey, fresh.PublicKey) {
		t.Fatal("reset reused identity")
	}
	// Reset must remove the Noise key even when the Ed25519 key is absent.
	if err := os.Remove(filepath.Join(dir, "devices", "identity.ed25519")); err != nil {
		t.Fatal(err)
	}
	if err := ResetIdentity(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("orphan key: %v", err)
	}
	if err := publishNoise(path, fresh.Noise.Private); err != nil {
		t.Fatal(err)
	}
	stat, err = os.Stat(path)
	if err != nil || stat.Mode().Perm() != 0600 {
		t.Fatalf("published permissions: %v, %v", stat, err)
	}
}
