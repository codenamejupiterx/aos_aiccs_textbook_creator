// src/lib/imageGen.ts
/* eslint-disable */

/**
 * Generate an image for the given description using OpenAI's image API.
 * Returns a data: URL (preferred) or an https URL, or "" on failure.
 */
export async function generateDiagramImage(desc: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[imageGen] no OPENAI_API_KEY set");
    return "";
  }

  const prompt = desc?.trim();
  if (!prompt) return "";

  const model = "gpt-image-1";

  try {
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.OPENAI_ORG || process.env.OPENAI_ORGANIZATION
          ? {
              "OpenAI-Organization":
                process.env.OPENAI_ORG || process.env.OPENAI_ORGANIZATION,
            }
          : {}),
      },
      body: JSON.stringify({
        model,
        prompt,
        size: "1024x1024",
        n: 1,
        // 🔹 ask specifically for base64 so we can embed directly
        response_format: "b64_json",
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[imageGen] HTTP error:", resp.status, text);
      return "";
    }

    const data = await resp.json();
    const first = data?.data?.[0];

    // 🔹 Prefer embedded base64
    if (first?.b64_json) {
      return `data:image/png;base64,${first.b64_json}`;
    }

    // Fallback: hosted URL if OpenAI ever returns only url
    if (first?.url) {
      return first.url as string;
    }

    return "";
  } catch (err: any) {
    console.error("[imageGen] image generation failed:", err?.message || err);
    return "";
  }
}
