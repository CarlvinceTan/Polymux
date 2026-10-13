package link

import (
	"crypto/ed25519"
	"errors"
)

type Pairing struct {
	Peer ed25519.PublicKey
	Role string
}

func NewPairing(peer ed25519.PublicKey) (Pairing, error) {
	if len(peer) != ed25519.PublicKeySize {
		return Pairing{}, errors.New("invalid peer key")
	}
	return Pairing{Peer: append(ed25519.PublicKey(nil), peer...), Role: "client"}, nil
}
