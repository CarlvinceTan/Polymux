package link

import (
	"bytes"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/flynn/noise"
)

func loadNoise(dir string) (noise.DHKey, error) {
	path := filepath.Join(dir, "devices", "noise.x25519")
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		key, err := noise.DH25519.GenerateKeypair(rand.Reader)
		if err != nil {
			return noise.DHKey{}, fmt.Errorf("generate noise key: %w", err)
		}
		if err := publishNoise(path, key.Private); err != nil {
			return noise.DHKey{}, err
		}
		return loadNoise(dir)
	}
	if err != nil {
		return noise.DHKey{}, fmt.Errorf("read noise key: %w", err)
	}
	if len(data) != 32 {
		return noise.DHKey{}, errors.New("invalid noise identity; explicitly reset it")
	}
	if err := os.Chmod(path, 0600); err != nil {
		return noise.DHKey{}, fmt.Errorf("protect noise key: %w", err)
	}
	key, err := noise.DH25519.GenerateKeypair(bytes.NewReader(data))
	if err != nil {
		return noise.DHKey{}, fmt.Errorf("load noise key: %w", err)
	}
	return key, nil
}

func publishNoise(path string, key []byte) (err error) {
	f, err := os.CreateTemp(filepath.Dir(path), ".noise-*")
	if err != nil {
		return fmt.Errorf("create noise key: %w", err)
	}
	defer func() { err = errors.Join(err, os.Remove(f.Name())) }()
	err = f.Chmod(0600)
	if err == nil {
		_, err = f.Write(key)
	}
	if err == nil {
		err = f.Sync()
	}
	err = errors.Join(err, f.Close())
	if err != nil {
		return fmt.Errorf("persist noise key: %w", err)
	}
	if err := os.Link(f.Name(), path); err != nil && !errors.Is(err, os.ErrExist) {
		return fmt.Errorf("publish noise key: %w", err)
	}
	return nil
}
