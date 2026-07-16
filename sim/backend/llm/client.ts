/** LLM adapter — OpenAI-compatible chat API via AgentSociety env vars. */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  readonly mode: "mock" | "live";
  complete(messages: LlmMessage[]): Promise<string>;
}

export interface LlmEnvConfig {
  apiBase: string;
  apiKey: string;
  model: string;
}

const ENV_BASE = "AGENTSOCIETY_LLM_API_BASE";
const ENV_KEY = "AGENTSOCIETY_LLM_API_KEY";
const ENV_MODEL = "AGENTSOCIETY_LLM_MODEL";

/** Read AgentSociety-compatible LLM settings from process.env. */
export function readLlmEnv(): LlmEnvConfig | null {
  const apiKey = process.env[ENV_KEY]?.trim();
  const apiBase = (process.env[ENV_BASE]?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env[ENV_MODEL]?.trim();
  if (!apiKey || !model) return null;
  return { apiBase, apiKey, model };
}

export class MockLlmClient implements LlmClient {
  readonly mode = "mock" as const;

  async complete(_messages: LlmMessage[]): Promise<string> {
    return JSON.stringify({
      utterance: "（mock）人情往来，改日再叙。",
      affectScore: 0.4,
      intent: null,
    });
  }
}

/** OpenAI-compatible `/chat/completions` client (AgentSociety gateway friendly). */
export class OpenAiCompatibleLlmClient implements LlmClient {
  readonly mode = "live" as const;

  constructor(private readonly cfg: LlmEnvConfig) {}

  async complete(messages: LlmMessage[]): Promise<string> {
    const url = `${this.cfg.apiBase}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.length) {
      throw new Error("LLM response missing choices[0].message.content");
    }
    return content;
  }
}

export type LlmModePreference = "mock" | "live" | "auto";

/**
 * Factory:
 * - `mock` — always mock
 * - `live` — require env vars or throw
 * - `auto` — live if KEY+MODEL set, else mock
 */
export function createLlmClient(preference: LlmModePreference = "auto"): LlmClient {
  if (preference === "mock") return new MockLlmClient();

  const env = readLlmEnv();
  if (preference === "live") {
    if (!env) {
      throw new Error(
        `llmMode=live requires ${ENV_KEY} and ${ENV_MODEL} (optional ${ENV_BASE})`,
      );
    }
    return new OpenAiCompatibleLlmClient(env);
  }

  // auto
  return env ? new OpenAiCompatibleLlmClient(env) : new MockLlmClient();
}

export function describeLlmClient(client: LlmClient): Record<string, string> {
  if (client.mode === "mock") return { mode: "mock" };
  const env = readLlmEnv();
  return {
    mode: "live",
    apiBase: env?.apiBase ?? "(unknown)",
    model: env?.model ?? "(unknown)",
    // never log api key
  };
}
