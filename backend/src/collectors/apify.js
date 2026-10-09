import { config } from '../config.js';
import { cache } from '../db/index.js';
import { FatalError, retry, sha1 } from '../lib/util.js';
import { logger } from '../lib/logger.js';

/**
 * Run an Apify actor synchronously and return its dataset items.
 * Results are cached briefly per (actor, input) so a retried or repeated
 * search doesn't pay for the same scrape twice.
 */
export async function runActor(actorId, input, { label = actorId } = {}) {
  if (!config.apify.token) throw new FatalError('APIFY_TOKEN is not set', 500);
  const key = `apify:${actorId}:${sha1(JSON.stringify(input))}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const timeoutSecs = Math.floor(config.apify.timeoutMs / 1000);
  const url = `${config.apify.baseUrl}/acts/${actorId}/run-sync-get-dataset-items?timeout=${timeoutSecs}&clean=true`;

  const items = await retry(
    async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apify.token}` },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(config.apify.timeoutMs + 15000),
      });
      if (res.status === 401 || res.status === 403) throw new FatalError(`Apify auth failed for ${label} (HTTP ${res.status}). Check APIFY_TOKEN.`, res.status);
      if (res.status === 402) throw new FatalError(`Apify account is out of credits (${label}).`, 402);
      if (res.status === 404) throw new FatalError(`Apify actor "${actorId}" not found.`, 404);
      if (res.status === 429) {
        const err = new Error(`Apify rate limited (${label})`);
        err.retryAfterMs = Number(res.headers.get('retry-after') || 10) * 1000;
        throw err;
      }
      if (!res.ok) throw new Error(`Apify ${label} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error(`Apify ${label} returned non-array`);
      return data;
    },
    { retries: config.pipeline.retries, onRetry: (err, n) => logger.warn({ err: err.message, attempt: n, actor: actorId }, 'apify retry') },
  );

  // Items that are actually error rows (blocked, login wall) are logged and dropped.
  const errors = items.filter((i) => i.error || i.errorDescription);
  if (errors.length) logger.warn({ actor: actorId, count: errors.length, sample: errors[0].error || errors[0].errorDescription }, 'apify error rows');
  const good = items.filter((i) => !i.error && !i.errorDescription);
  cache.set(key, good, config.cache.collectorTtlMs);
  return good;
}
