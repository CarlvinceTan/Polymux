package link

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

type Offer struct {
	Issuer  ed25519.PublicKey
	Secret  [32]byte
	LAN     []string
	Expires time.Time
	Code    string
}

func NewOffer(id Identity, lan []string, now time.Time) (Offer, error) {
	if len(id.PublicKey) != ed25519.PublicKeySize {
		return Offer{}, errors.New("invalid issuer key")
	}
	o := Offer{Issuer: append(ed25519.PublicKey(nil), id.PublicKey...), LAN: append([]string(nil), lan...), Expires: now.Add(3 * time.Minute)}
	if _, err := rand.Read(o.Secret[:]); err != nil {
		return Offer{}, err
	}
	o.Code = digits(o.Secret, []byte("polymux-code"))
	return o, nil
}

func (o Offer) URI() string {
	q := url.Values{"v": {"1"}, "k": {base64.RawURLEncoding.EncodeToString(o.Issuer)}, "s": {base64.RawURLEncoding.EncodeToString(o.Secret[:])}, "l": {strings.Join(o.LAN, ",")}, "n": {""}}
	return "polymux://pair?" + q.Encode()
}

// ParseOffer reads wire data; expiration is enforced by the issuer's registry.
func ParseOffer(uri string) (Offer, error) {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "polymux" || u.Host != "pair" || u.Path != "" || u.User != nil || u.Fragment != "" {
		return Offer{}, errors.New("invalid pairing URI")
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(q) != 5 {
		return Offer{}, errors.New("invalid pairing parameters")
	}
	for _, name := range []string{"v", "k", "s", "l", "n"} {
		if len(q[name]) != 1 {
			return Offer{}, errors.New("invalid pairing parameters")
		}
	}
	if q.Get("v") != "1" || q.Get("n") != "" {
		return Offer{}, errors.New("unsupported pairing version or hints")
	}
	key, err := base64.RawURLEncoding.Strict().DecodeString(q.Get("k"))
	if err != nil || len(key) != ed25519.PublicKeySize {
		return Offer{}, errors.New("invalid issuer key")
	}
	secret, err := base64.RawURLEncoding.Strict().DecodeString(q.Get("s"))
	if err != nil || len(secret) != 32 {
		return Offer{}, errors.New("invalid pairing secret")
	}
	o := Offer{Issuer: key}
	copy(o.Secret[:], secret)
	if q.Get("l") != "" {
		o.LAN = strings.Split(q.Get("l"), ",")
	}
	o.Code = digits(o.Secret, []byte("polymux-code"))
	return o, nil
}

// SAS requires issuer then peer on both devices; swapping the roles changes it.
func SAS(issuer, peer ed25519.PublicKey, secret [32]byte) string {
	message := append([]byte("polymux-sas"), issuer...)
	message = append(message, peer...)
	return digits(secret, message)
}

func digits(secret [32]byte, message []byte) string {
	mac := hmac.New(sha256.New, secret[:])
	mac.Write(message)
	sum := mac.Sum(nil)
	for {
		for i := 0; i < len(sum); i += 4 {
			n := binary.BigEndian.Uint32(sum[i : i+4])
			// Rejection sampling avoids modulo bias for one million values.
			if n < 4294000000 {
				return fmt.Sprintf("%06d", n%1000000)
			}
		}
		mac.Reset()
		mac.Write(sum)
		sum = mac.Sum(nil)
	}
}
