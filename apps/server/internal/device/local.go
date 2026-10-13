package device

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// Local provisions the owner app without granting native control capabilities.
func (s *Store) Local(ctx context.Context, dir string) (string, error) {
	path := filepath.Join(dir, "devices", "local-token")
	data, err := os.ReadFile(path)
	if err == nil {
		token := string(data)
		if _, err := s.Authenticate(ctx, token); err != nil {
			return "", err
		}
		return token, os.Chmod(path, 0600)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	token := randomID()
	_, err = s.db.ExecContext(ctx, `INSERT INTO devices(id,name,agent,capabilities,token_hash) VALUES(?,?,?,?,?)`, randomID(), "Local Mac app", "local", "[]", hash(token))
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(token), 0600); err != nil {
		return "", err
	}
	return token, nil
}
