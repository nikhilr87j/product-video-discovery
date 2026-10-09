import dotenv from 'dotenv';

// backend/.env first, then the repo-root .env (shared with docker compose).
dotenv.config({ path: ['.env', '../.env'], quiet: true });

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

const geminiKey = process.env.GEMINI_API_KEY || '';
const apifyToken = process.env.APIFY_TOKEN || '';

export const config = {
  port: num(process.env.PORT, 4000),
  dbPath: process.env.DB_PATH || './data/pvd.sqlite',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  logLevel: process.env.LOG_LEVEL || 'info',

  // When keys are missing we fall back to deterministic mock providers so the
  // whole pipeline (dedup, expansion, scoring, UI) can be demoed offline.
  mockMode: bool(process.env.MOCK_MODE, !geminiKey || !apifyToken),

  gemini: {
    apiKey: geminiKey,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    timeoutMs: num(process.env.GEMINI_TIMEOUT_MS, 60000),
    // Thumbnails compared per vision call (product image + N candidates).
    scoreBatchSize: num(process.env.SCORE_BATCH_SIZE, 8),
  },

  apify: {
    token: apifyToken,
    baseUrl: 'https://api.apify.com/v2',
    instagramActor: process.env.APIFY_INSTAGRAM_ACTOR || 'apify~instagram-hashtag-scraper',
    metaActor: process.env.APIFY_META_ACTOR || 'curious_coder~facebook-ads-library-scraper',
    tiktokActor: process.env.APIFY_TIKTOK_ACTOR || 'clockworks~tiktok-scraper',
    timeoutMs: num(process.env.APIFY_TIMEOUT_MS, 180000),
    metaCountry: process.env.META_AD_COUNTRY || 'IN',
  },

  pipeline: {
    minPerSource: num(process.env.MIN_PER_SOURCE, 20),
    matchThreshold: num(process.env.MATCH_THRESHOLD, 55),
    maxRounds: num(process.env.MAX_EXPANSION_ROUNDS, 5),
    // Candidates sent to the vision model per source per round (cost cap).
    maxVisionCandidates: num(process.env.MAX_VISION_CANDIDATES, 60),
    jobConcurrency: num(process.env.JOB_CONCURRENCY, 2),
    sourceTimeoutMs: num(process.env.SOURCE_TIMEOUT_MS, 240000),
    retries: num(process.env.SOURCE_RETRIES, 2),
    phashDistance: num(process.env.PHASH_MAX_DISTANCE, 6),
  },

  cache: {
    productTtlMs: num(process.env.PRODUCT_CACHE_TTL_H, 168) * 3600_000,
    collectorTtlMs: num(process.env.COLLECTOR_CACHE_TTL_H, 6) * 3600_000,
  },
};
