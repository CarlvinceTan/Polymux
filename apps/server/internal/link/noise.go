package link

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"github.com/flynn/noise"
)

const HandshakeTimeout = 10 * time.Second

const noisePrologue = "polymux/1"
const frameLimit = 65535
const plainLimit = frameLimit - 16

func noiseConfig(static noise.DHKey, initiator bool, pattern noise.HandshakePattern) noise.Config {
	return noise.Config{CipherSuite: noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s), Pattern: pattern, Initiator: initiator, Prologue: []byte(noisePrologue), StaticKeypair: static}
}

// PairServer authenticates first contact with a 32-byte pairing secret.
func PairServer(conn net.Conn, static noise.DHKey, secret []byte) (*Session, []byte, error) {
	return pairNoise(conn, static, secret, false)
}

func PairClient(conn net.Conn, static noise.DHKey, secret []byte) (*Session, []byte, error) {
	return pairNoise(conn, static, secret, true)
}

func pairNoise(conn net.Conn, static noise.DHKey, secret []byte, initiator bool) (*Session, []byte, error) {
	if len(secret) != 32 {
		return nil, nil, errors.New("noise pairing secret must be 32 bytes")
	}
	if err := conn.SetDeadline(time.Now().Add(HandshakeTimeout)); err != nil {
		return nil, nil, errors.Join(err, conn.Close())
	}
	defer conn.SetDeadline(time.Time{})
	cfg := noiseConfig(static, initiator, noise.HandshakeXX)
	cfg.PresharedKey = bytes.Clone(secret)
	// flynn/noise appends psk to messagePatterns[2], matching Noise XXpsk3.
	cfg.PresharedKeyPlacement = 3
	session, peer, err := handshake(conn, cfg, nil)
	if err != nil {
		return nil, nil, err
	}
	// XXpsk3 confirms the responder's PSK only after the final message.
	// Reserve the first encrypted frame for key confirmation before returning.
	if initiator {
		var confirm [1]byte
		_, err = io.ReadFull(session, confirm[:])
		if err == nil && confirm[0] != 1 {
			err = errors.New("invalid noise confirmation")
		}
	} else {
		_, err = session.Write([]byte{1})
	}
	if err != nil {
		return nil, nil, errors.Join(fmt.Errorf("confirm noise pairing: %w", err), conn.Close())
	}
	return session, peer, nil
}

func Accept(conn net.Conn, static noise.DHKey, isPaired func(pub []byte) bool) (*Session, error) {
	if isPaired == nil {
		return nil, errors.New("noise pairing check is required")
	}
	session, _, err := handshake(conn, noiseConfig(static, false, noise.HandshakeIK), isPaired)
	return session, err
}

func Dial(conn net.Conn, static noise.DHKey, peerStatic []byte) (*Session, error) {
	if len(peerStatic) != 32 {
		return nil, errors.New("invalid noise peer key")
	}
	cfg := noiseConfig(static, true, noise.HandshakeIK)
	cfg.PeerStatic = bytes.Clone(peerStatic)
	session, _, err := handshake(conn, cfg, nil)
	return session, err
}

func handshake(conn net.Conn, cfg noise.Config, paired func([]byte) bool) (_ *Session, _ []byte, err error) {
	if cfg.Pattern.Name != noise.HandshakeXX.Name {
		if err := conn.SetDeadline(time.Now().Add(HandshakeTimeout)); err != nil {
			return nil, nil, errors.Join(err, conn.Close())
		}
		defer conn.SetDeadline(time.Time{})
	}
	// A failed handshake cannot safely be resumed on this stream.
	defer func() {
		if err != nil {
			err = errors.Join(err, conn.Close())
		}
	}()
	if len(cfg.StaticKeypair.Private) != 32 || len(cfg.StaticKeypair.Public) != 32 {
		return nil, nil, errors.New("invalid noise static key")
	}
	hs, err := noise.NewHandshakeState(cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("initialize noise: %w", err)
	}
	var first, second *noise.CipherState
	for i := 0; i < len(cfg.Pattern.Messages); i++ {
		if (i%2 == 0) == cfg.Initiator {
			var msg []byte
			msg, first, second, err = hs.WriteMessage(nil, nil)
			if err == nil {
				err = writeFrame(conn, msg)
			}
		} else {
			var msg, payload []byte
			msg, err = readFrame(conn)
			if err == nil {
				payload, first, second, err = hs.ReadMessage(nil, msg)
			}
			if err == nil && len(payload) != 0 {
				err = errors.New("unexpected noise handshake payload")
			}
			if err == nil && paired != nil && !paired(bytes.Clone(hs.PeerStatic())) {
				err = errors.New("unpaired noise peer")
			}
		}
		if err != nil {
			return nil, nil, fmt.Errorf("noise handshake: %w", err)
		}
	}
	tx, rx := first, second
	if !cfg.Initiator {
		tx, rx = second, first
	}
	return &Session{conn: conn, tx: tx, rx: rx}, bytes.Clone(hs.PeerStatic()), nil
}

// Session carries a byte stream in authenticated, big-endian uint16 frames.
// Deadlines and Close operate on the underlying connection.
type Session struct {
	conn              net.Conn
	tx, rx            *noise.CipherState
	writeMu, readMu   sync.Mutex
	pending           []byte
	readErr, writeErr error
}

var _ net.Conn = (*Session)(nil)

func (s *Session) Close() error                       { return s.conn.Close() }
func (s *Session) LocalAddr() net.Addr                { return s.conn.LocalAddr() }
func (s *Session) RemoteAddr() net.Addr               { return s.conn.RemoteAddr() }
func (s *Session) SetDeadline(t time.Time) error      { return s.conn.SetDeadline(t) }
func (s *Session) SetReadDeadline(t time.Time) error  { return s.conn.SetReadDeadline(t) }
func (s *Session) SetWriteDeadline(t time.Time) error { return s.conn.SetWriteDeadline(t) }

func (s *Session) Read(p []byte) (int, error) {
	s.readMu.Lock()
	defer s.readMu.Unlock()
	if len(p) == 0 {
		return 0, nil
	}
	for len(s.pending) == 0 {
		if s.readErr != nil {
			return 0, s.readErr
		}
		msg, err := readFrame(s.conn)
		if err == nil {
			s.pending, err = s.rx.Decrypt(nil, nil, msg)
		}
		if err != nil {
			s.readErr = fmt.Errorf("read noise frame: %w", err)
			s.readErr = errors.Join(s.readErr, s.conn.Close())
			return 0, s.readErr
		}
	}
	n := copy(p, s.pending)
	s.pending = s.pending[n:]
	return n, nil
}

func (s *Session) Write(p []byte) (int, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if s.writeErr != nil {
		return 0, s.writeErr
	}
	total := 0
	for len(p) > 0 {
		n := min(len(p), plainLimit)
		msg, err := s.tx.Encrypt(nil, nil, p[:n])
		if err == nil {
			err = writeFrame(s.conn, msg)
		}
		if err != nil {
			s.writeErr = errors.Join(fmt.Errorf("write noise frame: %w", err), s.conn.Close())
			return total, s.writeErr
		}
		total += n
		p = p[n:]
	}
	return total, nil
}

func readFrame(r io.Reader) ([]byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return nil, err
	}
	msg := make([]byte, int(binary.BigEndian.Uint16(header[:])))
	if len(msg) == 0 {
		return nil, errors.New("empty noise frame")
	}
	_, err := io.ReadFull(r, msg)
	return msg, err
}

func writeFrame(w io.Writer, msg []byte) error {
	if len(msg) == 0 || len(msg) > frameLimit {
		return errors.New("invalid noise frame length")
	}
	frame := make([]byte, 2+len(msg))
	binary.BigEndian.PutUint16(frame, uint16(len(msg)))
	copy(frame[2:], msg)
	for len(frame) > 0 {
		n, err := w.Write(frame)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		frame = frame[n:]
	}
	return nil
}
