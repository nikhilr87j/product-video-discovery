import crypto from 'node:crypto';

export const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const newId = () => crypto.randomUUID();

export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout(promise, ms, label = 'operation') {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new TimeoutError(label, ms)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/** Errors that should not be retried (bad input, auth). */
export class FatalError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'FatalError';
    this.status = status;
  }
}

/**
 * Retry with exponential backoff + jitter. Honours `err.retryAfterMs`
 * (set by HTTP helpers on 429) and never retries FatalError.
 */
export async function retry(fn, { retries = 2, baseMs = 800, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (err instanceof FatalError || attempt >= retries) throw err;
      const wait = err.retryAfterMs ?? baseMs * 2 ** attempt + Math.random() * 300;
      onRetry?.(err, attempt + 1, wait);
      await sleep(wait);
      attempt++;
    }
  }
}

/** Run async fn over items with bounded concurrency, preserving order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export function normalizeText(s = '') {
  return String(s)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@]\w+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip query strings / CDN signatures so the same file from two URLs matches. */
export function canonicalMediaUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u);
    return `${url.hostname.replace(/^scontent[^.]*\./, 'scontent.')}${url.pathname}`.toLowerCase();
  } catch {
    return String(u).split('?')[0].toLowerCase();
  }
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const uniq = (arr) => [...new Set(arr.filter(Boolean))];
