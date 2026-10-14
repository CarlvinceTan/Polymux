package providers

// Empty tags indicate model metadata or endpoint discovery is required.
var Catalogue = map[string][]string{
	"openai":     {"text", "vision", "image-gen", "stt", "tts", "live", "embed"},
	"anthropic":  {"text", "vision"},
	"gemini":     {"text", "vision", "image-gen", "video-gen", "stt", "tts", "live", "embed"},
	"openrouter": {},
	"xai":        {"text", "vision", "image-gen"},
	"deepseek":   {"text"},
	"elevenlabs": {"stt", "tts"},
	"ollama":     {},
	"lmstudio":   {},
	"custom":     {},
}
