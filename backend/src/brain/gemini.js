import { config } from '../config.js';
import { FatalError, retry } from '../lib/util.js';
import { logger } from '../lib/logger.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Call Gemini with text + inline images and a JSON response schema.
 * @param {Array<string | {mime: string, base64: string}>} parts
 */
export async function geminiJson(parts, responseSchema, { temperature = 0.1 } = {}) {
  if (!config.gemini.apiKey) throw new FatalError('GEMINI_API_KEY is not set', 500);
  const body = {
    contents: [
      {
        role: 'user',
        parts: parts.map((p) => (typeof p === 'string' ? { text: p } : { inline_data: { mime_type: p.mime, data: p.base64 } })),
      },
    ],
    generationConfig: { temperature, responseMimeType: 'application/json', responseSchema },
  };

  return retry(
    async () => {
      const res = await fetch(`${BASE}/${config.gemini.model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.gemini.timeoutMs),
      });
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new FatalError(`Gemini rejected the request (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`, res.status);
      }
      if (!res.ok) {
        const err = new Error(`Gemini HTTP ${res.status}`);
        if (res.status === 429) err.retryAfterMs = 5000;
        throw err;
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
      if (!text) throw new Error(`Gemini returned no content (${data.candidates?.[0]?.finishReason || 'unknown'})`);
      return JSON.parse(text);
    },
    { retries: 2, onRetry: (err, n) => logger.warn({ err: err.message, attempt: n }, 'gemini retry') },
  );
}
