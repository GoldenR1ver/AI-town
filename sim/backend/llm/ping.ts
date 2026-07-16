/**
 * Quick LLM ping: uses AGENTSOCIETY_LLM_* env vars.
 * Usage: npx tsx sim/backend/llm/ping.ts
 */
import { createLlmClient, describeLlmClient } from "./client.js";

async function main(): Promise<void> {
  const mode = (process.env.LLM_MODE as "mock" | "live" | "auto" | undefined) ?? "live";
  const client = createLlmClient(mode);
  console.log("client:", describeLlmClient(client));
  const text = await client.complete([
    { role: "system", content: "用一句话回复。" },
    { role: "user", content: "确认你已接通。只回复：ok" },
  ]);
  console.log("response:", text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
