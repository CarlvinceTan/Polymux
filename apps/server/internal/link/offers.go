package link

import (
	"crypto/hmac"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

var (
	ErrInvalid = errors.New("invalid or expired pairing offer")
	ErrLocked  = errors.New("pairing locked for 15 minutes")
)

// Offers applies a registry-wide attempt limit because redemption has no caller ID.
type Offers struct {
	mu       sync.Mutex
	items    map[[32]byte]Offer
	used     map[[32]byte]bool
	failures int
	locked   time.Time
}

func (r *Offers) Add(o Offer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.items == nil {
		r.items = make(map[[32]byte]Offer)
		r.used = make(map[[32]byte]bool)
	}
	if r.used[o.Secret] {
		return
	}
	o.Issuer = append([]byte(nil), o.Issuer...)
	o.LAN = append([]string(nil), o.LAN...)
	o.Code = digits(o.Secret, []byte("polymux-code"))
	r.items[o.Secret] = o
}

// Redeem requires now from the server clock, never from the caller.
func (r *Offers) Redeem(secretOrCode string, now time.Time) (Offer, error) {
	if now.IsZero() {
		return Offer{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if now.Before(r.locked) {
		return Offer{}, ErrLocked
	}
	if !r.locked.IsZero() {
		r.failures = 0
		r.locked = time.Time{}
	}
	var match Offer
	count := 0
	for secret, o := range r.items {
		if !now.Before(o.Expires) {
			delete(r.items, secret)
			continue
		}
		encoded := base64.RawURLEncoding.EncodeToString(secret[:])
		if hmac.Equal([]byte(secretOrCode), []byte(encoded)) || hmac.Equal([]byte(secretOrCode), []byte(o.Code)) {
			match = o
			count++
		}
	}
	// Ambiguous short codes must never select an arbitrary offer.
	if count == 1 {
		delete(r.items, match.Secret)
		r.used[match.Secret] = true
		r.failures = 0
		return match, nil
	}
	r.failures++
	if r.failures >= 5 {
		r.locked = now.Add(15 * time.Minute)
		return Offer{}, ErrLocked
	}
	return Offer{}, ErrInvalid
}
