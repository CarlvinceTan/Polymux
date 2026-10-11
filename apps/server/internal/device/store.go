package device

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

const Version = 1

type Ticket struct {
	Version      int      `json:"version"`
	URL          string   `json:"url"`
	Certificate  string   `json:"certificate"`
	Code         string   `json:"code"`
	Agent        string   `json:"agent"`
	Capabilities []string `json:"capabilities"`
}

type Pairing struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Agent        string   `json:"agent"`
	Capabilities []string `json:"capabilities"`
	Revoked      bool     `json:"revoked"`
}

type Enrollment struct {
	Pairing
	Token string `json:"token"`
}

type Store struct {
	db     *sql.DB
	cert   tls.Certificate
	mu     sync.Mutex
	issuer *x509.Certificate
	key    *ecdsa.PrivateKey
}

func Open(ctx context.Context, dir, hostname string) (*Store, error) {
	dir = filepath.Join(dir, "devices")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "pairing.db")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return nil, err
	}
	if err := f.Close(); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite3", "file:"+path+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	_, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS identity(id INTEGER PRIMARY KEY CHECK(id=1), certificate BLOB NOT NULL, key BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS tickets(hash TEXT PRIMARY KEY, agent TEXT NOT NULL, capabilities TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, agent TEXT NOT NULL, capabilities TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);`)
	if err == nil {
		err = s.identity(ctx, hostname)
	}
	if err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }
func (s *Store) TLSConfig() *tls.Config {
	return &tls.Config{MinVersion: tls.VersionTLS13, GetCertificate: s.certificate}
}

func (s *Store) certificate(_ *tls.ClientHelloInfo) (*tls.Certificate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !time.Now().Before(s.issuer.NotAfter) {
		return nil, errors.New("device identity expired; revoke pairings and explicitly reset identity")
	}
	if s.cert.Leaf != nil && time.Until(s.cert.Leaf.NotAfter) > 24*time.Hour {
		cert := s.cert
		return &cert, nil
	}
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, err
	}
	template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Polymux device control"},
		NotBefore: time.Now().Add(-time.Minute), NotAfter: minTime(time.Now().Add(90*24*time.Hour), s.issuer.NotAfter),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true, DNSNames: s.issuer.DNSNames, IPAddresses: s.issuer.IPAddresses}
	der, err := x509.CreateCertificate(rand.Reader, template, s.issuer, &private.PublicKey, s.key)
	if err != nil {
		return nil, err
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	s.cert = tls.Certificate{Certificate: [][]byte{der, s.issuer.Raw}, PrivateKey: private, Leaf: leaf}
	// Return an immutable generation while a later handshake renews the leaf.
	cert := s.cert
	return &cert, nil
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func (s *Store) identity(ctx context.Context, hostname string) error {
	var certificate, key []byte
	err := s.db.QueryRowContext(ctx, `SELECT certificate,key FROM identity WHERE id=1`).Scan(&certificate, &key)
	if errors.Is(err, sql.ErrNoRows) {
		private, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if e != nil {
			return e
		}
		serial, e := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
		if e != nil {
			return e
		}
		template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Polymux device identity"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().AddDate(5, 0, 0), KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature, BasicConstraintsValid: true, IsCA: true, MaxPathLenZero: true}
		if ip := net.ParseIP(hostname); ip != nil {
			template.IPAddresses = []net.IP{ip}
		} else {
			template.DNSNames = []string{hostname}
		}
		der, e := x509.CreateCertificate(rand.Reader, template, template, &private.PublicKey, private)
		if e != nil {
			return e
		}
		pk, e := x509.MarshalPKCS8PrivateKey(private)
		if e != nil {
			return e
		}
		certificate = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
		key = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pk})
		// Concurrent CLI enrollment and server startup share exactly one identity.
		if _, e = s.db.ExecContext(ctx, `INSERT OR IGNORE INTO identity VALUES(1,?,?)`, certificate, key); e != nil {
			return e
		}
		err = s.db.QueryRowContext(ctx, `SELECT certificate,key FROM identity WHERE id=1`).Scan(&certificate, &key)
	}
	if err != nil {
		return err
	}
	identity, err := tls.X509KeyPair(certificate, key)
	if err != nil {
		return err
	}
	s.issuer, err = x509.ParseCertificate(identity.Certificate[0])
	if err != nil {
		return err
	}
	private, ok := identity.PrivateKey.(*ecdsa.PrivateKey)
	if !ok || !s.issuer.IsCA || !time.Now().Before(s.issuer.NotAfter) {
		return errors.New("invalid or expired device identity; explicitly reset it and re-pair")
	}
	s.key = private
	_, err = s.certificate(nil)
	return err
}

func validCaps(caps []string) bool {
	if len(caps) == 0 || len(caps) > 2 {
		return false
	}
	seen := map[string]bool{}
	for _, cap := range caps {
		if (cap != "native" && cap != "commands") || seen[cap] {
			return false
		}
		seen[cap] = true
	}
	return true
}

func (s *Store) Issue(ctx context.Context, address, agent string, caps []string) (string, error) {
	u, err := url.Parse(address)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("pairing requires an HTTPS control address")
	}
	if err := s.issuer.VerifyHostname(u.Hostname()); err != nil {
		return "", errors.New("control address changed; explicitly reset device identity and re-pair")
	}
	if agent == "" || len(agent) > 128 || strings.ContainsAny(agent, "/\\.\x00") || !validCaps(caps) {
		return "", errors.New("invalid agent or capabilities")
	}
	code := randomID()
	data, err := json.Marshal(caps)
	if err != nil {
		return "", err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO tickets VALUES(?,?,?,?)`, hash(code), agent, string(data), time.Now().Add(10*time.Minute).Unix())
	if err != nil {
		return "", err
	}
	ticket, err := json.Marshal(Ticket{Version, strings.TrimRight(address, "/"), base64.StdEncoding.EncodeToString(s.issuer.Raw), code, agent, slices.Clone(caps)})
	if err != nil {
		return "", err
	}
	return "polymux-pair:" + base64.RawURLEncoding.EncodeToString(ticket), nil
}

func (s *Store) Enroll(ctx context.Context, code, name string, caps []string) (Enrollment, error) {
	if len(code) != 43 || strings.TrimSpace(name) == "" || len(name) > 64 || strings.ContainsAny(name, "\x00\r\n") || !validCaps(caps) {
		return Enrollment{}, errors.New("invalid enrollment")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Enrollment{}, err
	}
	defer tx.Rollback()
	var agent, encoded string
	err = tx.QueryRowContext(ctx, `DELETE FROM tickets WHERE hash=? AND expires>? RETURNING agent,capabilities`, hash(code), time.Now().Unix()).Scan(&agent, &encoded)
	if err != nil {
		return Enrollment{}, errors.New("pairing code expired or already used")
	}
	var approved []string
	if err := json.Unmarshal([]byte(encoded), &approved); err != nil {
		return Enrollment{}, err
	}
	for _, cap := range caps {
		if !slices.Contains(approved, cap) {
			return Enrollment{}, errors.New("capability not approved")
		}
	}
	data, err := json.Marshal(caps)
	if err != nil {
		return Enrollment{}, err
	}
	out := Enrollment{Pairing: Pairing{ID: randomID(), Name: name, Agent: agent, Capabilities: slices.Clone(caps)}, Token: randomID()}
	_, err = tx.ExecContext(ctx, `INSERT INTO devices(id,name,agent,capabilities,token_hash) VALUES(?,?,?,?,?)`, out.ID, name, agent, string(data), hash(out.Token))
	if err != nil {
		return Enrollment{}, err
	}
	if err := tx.Commit(); err != nil {
		return Enrollment{}, err
	}
	return out, nil
}

func (s *Store) Authenticate(ctx context.Context, token string) (Pairing, error) {
	if len(token) != 43 {
		return Pairing{}, errors.New("invalid device credential")
	}
	var p Pairing
	var caps string
	err := s.db.QueryRowContext(ctx, `SELECT id,name,agent,capabilities,revoked FROM devices WHERE token_hash=? AND revoked=0`, hash(token)).Scan(&p.ID, &p.Name, &p.Agent, &caps, &p.Revoked)
	if err != nil {
		return Pairing{}, errors.New("device revoked or unknown")
	}
	err = json.Unmarshal([]byte(caps), &p.Capabilities)
	return p, err
}

func (s *Store) List(ctx context.Context) ([]Pairing, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,agent,capabilities,revoked FROM devices ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Pairing{}
	for rows.Next() {
		var p Pairing
		var caps string
		if err := rows.Scan(&p.ID, &p.Name, &p.Agent, &caps, &p.Revoked); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(caps), &p.Capabilities); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) Revoke(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE devices SET revoked=1 WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return errors.New("device not found")
	}
	return err
}

func randomID() string { return base64.RawURLEncoding.EncodeToString(randBytes(32)) }
func randBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}
func hash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
