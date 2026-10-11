package push

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/CarlvinceTan/luce/apps/server/internal/store"
)

type Config struct{ Path, KeyID, TeamID, Topic string }
type Sender struct {
	config Config
	key    *ecdsa.PrivateKey
	client *http.Client
	mu     sync.Mutex
	jwt    string
	issued time.Time
}

func Open(config Config) (*Sender, error) {
	if config.Path == "" || len(config.KeyID) != 10 || len(config.TeamID) != 10 || config.Topic == "" || strings.ContainsAny(config.Topic, "\r\n") {
		return nil, errors.New("incomplete APNs configuration")
	}
	info, err := os.Stat(config.Path)
	if err != nil {
		return nil, errors.New("APNs key file unavailable")
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 16384 {
		return nil, errors.New("APNs key requires an owner-only regular file")
	}
	data, err := os.ReadFile(config.Path)
	if err != nil {
		return nil, errors.New("APNs key file unavailable")
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("invalid APNs signing key")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("invalid APNs signing key")
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errors.New("APNs requires an ES256 key")
	}
	return &Sender{config: config, key: key, client: &http.Client{Timeout: 15 * time.Second}}, nil
}

func (s *Sender) token() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.jwt != "" && time.Since(s.issued) < 40*time.Minute {
		return s.jwt, nil
	}
	now := time.Now()
	header, _ := json.Marshal(map[string]any{"alg": "ES256", "kid": s.config.KeyID})
	claims, _ := json.Marshal(map[string]any{"iss": s.config.TeamID, "iat": now.Unix()})
	encode := base64.RawURLEncoding.EncodeToString
	payload := encode(header) + "." + encode(claims)
	hash := sha256.Sum256([]byte(payload))
	r, v, err := ecdsa.Sign(rand.Reader, s.key, hash[:])
	if err != nil {
		return "", err
	}
	signature := make([]byte, 64)
	r.FillBytes(signature[:32])
	v.FillBytes(signature[32:])
	s.jwt = payload + "." + encode(signature)
	s.issued = now
	return s.jwt, nil
}

func (s *Sender) Send(ctx context.Context, push store.Push) string {
	token, err := s.token()
	if err != nil {
		return "failed"
	}
	data, _ := json.Marshal(map[string]any{"aps": map[string]any{"alert": map[string]string{"title": push.Notice.Title, "body": "New message in Luce"}, "sound": "default", "thread-id": push.Notice.ConversationID}, "server": push.Device.Server, "conversationID": push.Notice.ConversationID, "messageID": push.Notice.MessageID})
	if len(data) > 4096 {
		return "failed"
	}
	endpoint := "https://api.push.apple.com"
	if push.Device.Environment == "sandbox" {
		endpoint = "https://api.sandbox.push.apple.com"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/3/device/"+push.Device.Token, bytes.NewReader(data))
	if err != nil {
		return "failed"
	}
	request.Header.Set("authorization", "bearer "+token)
	request.Header.Set("apns-topic", s.config.Topic)
	request.Header.Set("apns-push-type", "alert")
	request.Header.Set("apns-priority", "10")
	request.Header.Set("apns-expiration", strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10))
	hash := sha256.Sum256([]byte(push.Notice.MessageID))
	request.Header.Set("apns-collapse-id", base64.RawURLEncoding.EncodeToString(hash[:]))
	response, err := s.client.Do(request)
	if err != nil {
		return "unknown"
	}
	defer response.Body.Close()
	if response.StatusCode == 200 {
		return "sent"
	}
	var result struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result)
	if response.StatusCode == 410 || result.Reason == "BadDeviceToken" || result.Reason == "DeviceTokenNotForTopic" {
		return "invalid"
	}
	return "failed"
}
