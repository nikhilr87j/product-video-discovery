import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { newId } from '../lib/util.js';
import { assertSafeUrlShape } from '../lib/safeFetch.js';
import { normaliseImage } from '../services/productResolver.js';
import { SOURCES } from '../services/pipeline.js';
import * as repo from '../db/repo.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const SearchInput = z
  .object({
    query: z.string().trim().max(2000).optional().default(''),
    includeTiktok: z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'on', 'off'])])
      .optional()
      .transform((v) => v === true || v === 'true' || v === '1' || v === 'on'),
  });

// Tiny fixed-window limiter: searches cost real scraping credits.
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const w = hits.get(key) || { start: now, n: 0 };
  if (now - w.start > 60_000) Object.assign(w, { start: now, n: 0 });
  w.n++;
  hits.set(key, w);
  if (w.n > Number(process.env.SEARCHES_PER_MINUTE || 10)) {
    return res.status(429).json({ error: 'Too many searches. Wait a minute and try again.' });
  }
  next();
}

function withThumb(v) {
  const stored = [v.uid, v.thumbRef].find((u) => u && repo.hasThumb(u));
  return { ...v, thumbnailUrl: undefined, thumbnail: stored ? `/api/thumbs/${encodeURIComponent(stored)}` : v.thumbnailUrl || null };
}

export function apiRouter(queue) {
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ ok: true, mockMode: config.mockMode, minPerSource: config.pipeline.minPerSource, threshold: config.pipeline.matchThreshold, sources: SOURCES });
  });

  r.post('/search', rateLimit, upload.single('image'), async (req, res, next) => {
    try {
      const parsed = SearchInput.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
      const { query, includeTiktok } = parsed.data;
      if (!query && !req.file) return res.status(400).json({ error: 'Enter a product name or link, or upload a product image.' });

      const isUrl = /^https?:\/\//i.test(query);
      let url;
      let keyword;
      if (isUrl) {
        url = assertSafeUrlShape(query).toString(); // fast reject; DNS checks happen at fetch time
      } else if (query) {
        if (query.length > 200) return res.status(400).json({ error: 'Product names are limited to 200 characters.' });
        keyword = query;
      }

      let image;
      if (req.file) {
        try {
          image = await normaliseImage(req.file.buffer);
        } catch {
          return res.status(400).json({ error: 'The uploaded file is not a readable image.' });
        }
      }

      const id = newId();
      const inputType = url ? 'url' : keyword ? 'keyword' : 'image';
      repo.createSearch({ id, inputType, inputValue: url || keyword || req.file.originalname });
      queue.enqueue(id, { url, keyword, image, includeTiktok });
      res.status(202).json({ id, inputType });
    } catch (err) {
      next(err);
    }
  });

  r.get('/search/:id', (req, res) => {
    const s = repo.getSearch(req.params.id);
    if (!s) return res.status(404).json({ error: 'Search not found' });
    res.json({ ...s, results: s.results.map(withThumb) });
  });

  // Server-Sent Events: live pipeline progress (replays history for late joiners).
  r.get('/search/:id/events', (req, res) => {
    const s = repo.getSearch(req.params.id);
    if (!s) return res.status(404).json({ error: 'Search not found' });
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.flushHeaders();
    if (s.status === 'done' || s.status === 'failed') {
      res.write(`data: ${JSON.stringify(s.status === 'done' ? { type: 'done', summary: s.summary } : { type: 'error', message: s.error })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
      return res.end();
    }
    const send = (e) => {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (e.type === 'end') res.end();
    };
    const unsubscribe = queue.subscribe(req.params.id, send);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  r.get('/history', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ items: repo.listHistory(limit) });
  });

  r.get('/thumbs/:uid', (req, res) => {
    const t = repo.getThumb(req.params.uid);
    if (!t) return res.status(404).end();
    res.set({ 'content-type': t.mime, 'cache-control': 'public, max-age=604800, immutable' });
    res.end(Buffer.from(t.data));
  });

  return r;
}
