// src/lib/openai.ts
import OpenAI from "openai";

let _client: OpenAI | null = null;
let _loggedOnce = false;

function mask(v?: string) {
  return v ? `${v.slice(0, 7)}...${v.slice(-4)}` : "(unset)";
}

export function getOpenAI() {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY missing (set it in .env.local and restart the dev server)");
    }

    _client = new OpenAI({
      apiKey,
      // If you use org/project scoping, set these in .env.local
      organization: process.env.OPENAI_ORG || process.env.OPENAI_ORGANIZATION,
      project: process.env.OPENAI_PROJECT,
      // baseURL: process.env.OPENAI_BASE_URL, // <- only if you’re using a proxy/enterprise gateway
    });

    if (!_loggedOnce) {
      const model =
        process.env.OPENAI_MODEL ||
        process.env.OPENAI_TEXT_MODEL ||
        "gpt-4o";

      console.log(
        "[openai] key:", mask(apiKey),
        "| org:", process.env.OPENAI_ORG || process.env.OPENAI_ORGANIZATION || "(unset)",
        "| project:", process.env.OPENAI_PROJECT || "(unset)",
        "| model:", model
      );
      _loggedOnce = true;
    }
  }
  return _client;
}

export function getOpenAIModel() {
  return (
    process.env.OPENAI_MODEL ||
    process.env.OPENAI_TEXT_MODEL ||
    "gpt-4o"
  );
}
