# @midas/inference

Provider-neutral inference contracts for Midas, plus a thin `pi-ai` implementation.

```ts
import type { InferenceService } from "@midas/inference";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { PiInference } from "@midas/inference/pi";

const models = createModels();
models.setProvider(anthropicProvider());
const inference: InferenceService = new PiInference(models);
for await (const event of inference.stream({
  model: { provider: "anthropic", id: "claude-sonnet-4-6" },
  messages: [{ role: "user", content: "Hello" }],
})) {
  // Feed typed events into the Midas agent core.
}
```

The public contract owns model references, messages, tools, streaming events, usage and errors. Pi-specific model collections and provider setup are exposed only from `@midas/inference/pi`.

Provider registration belongs to the Electron composition layer rather than this package. Authentication is resolved by Pi from injected credentials or provider environment variables. Persistent desktop credentials should later use an Electron `safeStorage`-backed credential store; they must not be written to ordinary preferences or SQLite as plaintext.
