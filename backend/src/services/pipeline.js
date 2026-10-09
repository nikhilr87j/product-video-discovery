/**
 * One search = one run of this pipeline:
 *
 *   resolve product ─► analyse image ─┬─► Instagram collector ─┐
 *                                     ├─► Meta collector ──────┼─► save + summary
 *                                     └─► TikTok (optional) ───┘
 *
 * Each collector runs its own loop, isolated from the others:
 *   fetch a query plan step ─► de-dupe (within + history) ─► thumbnails/pHash
 *   ─► pre-rank by caption ─► vision score top K ─► keep ≥ threshold
 * and repeats with expanded queries / deeper pages until it has
 * `minPerSource` matches or runs out of plan, then reports any shortfall.
 */
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { withTimeout, uniq } from '../lib/util.js';
import { resolveProductUrl } from './productResolver.js';
import { analyzeProduct, attributeKeywords } from '../brain/analyze.js';
import { visionScore, textRelevance, combineScore, classify, bandFor } from '../brain/score.js';
import { mockAnalyze, mockVisionScore } from '../brain/mock.js';
import { collectInstagram } from '../collectors/instagram.js';
import { collectMeta } from '../collectors/meta.js';
import { collectTiktok } from '../collectors/tiktok.js';
import { mockCollectors } from '../collectors/mock.js';
import { DedupIndex, partition, signatures } from './dedup.js';
import { loadThumbs } from './thumbs.js';
import * as repo from '../db/repo.js';

export const SOURCES = {
  instagram: { label: 'Instagram Reels', required: true },
  meta: { label: 'Meta Ad Library', required: true },
  tiktok: { label: 'TikTok', required: false },
};

function providers() {
  if (config.mockMode) {
    return { analyze: mockAnalyze, score: mockVisionScore, collect: mockCollectors };
  }
  return {
    analyze: analyzeProduct,
    score: visionScore,
    collect: { instagram: collectInstagram, meta: collectMeta, tiktok: collectTiktok },
  };
}

/** Ordered list of fetch steps for a source: specific → broad → deeper pages. */
export function queryPlan(platform, a, maxRounds) {
  const isTag = platform === 'instagram';
  const primary = isTag ? a.hashtags.slice(0, 5) : a.metaQueries.slice(0, 3);
  const secondary = isTag
    ? uniq([...a.hashtags.slice(5), ...a.expandedHashtags]).slice(0, 8)
    : uniq([...a.metaQueries.slice(3), ...a.expandedQueries]).slice(0, 4);
  const steps = [
    { queries: primary, depth: 0, why: 'product-specific terms' },
    { queries: secondary, depth: 0, why: 'expanded / related terms' },
  ];
  // Then alternate deeper pages of both lists. Collectors return cumulative
  // pages, so already-seen items are dropped cheaply by id before any download.
  for (let depth = 1; steps.length < maxRounds + 1; depth++) {
    steps.push({ queries: primary, depth, why: `page ${depth + 1} of specific terms` });
    steps.push({ queries: secondary, depth, why: `page ${depth + 1} of expanded terms` });
  }
  return steps.filter((st) => st.queries.length).slice(0, Math.max(1, maxRounds + 1));
}

async function runSource(platform, ctx) {
  const { analysis, image, emit, history, current, prov } = ctx;
  const { minPerSource, matchThreshold, maxVisionCandidates, sourceTimeoutMs, maxRounds } = config.pipeline;
  const label = SOURCES[platform].label;
  const say = (status, message, extra = {}) => emit({ type: 'source', platform, status, message, ...extra });

  const keywords = attributeKeywords(analysis);
  const plan = queryPlan(platform, analysis, maxRounds);
  const matches = [];
  const low = [];
  const seenBefore = [];
  const pool = []; // fresh, not yet vision-scored, best caption match first
  const stats = { fetched: 0, duplicatesWithin: 0, previouslySeen: 0, scored: 0, rounds: 0, errors: [] };
  const deadline = Date.now() + sourceTimeoutMs;
  let step = 0;
  let failedInARow = 0;

  const counts = () => ({ matches: matches.length, low: low.length, previouslySeen: seenBefore.length, ...stats, errors: undefined });

  while (matches.length < minPerSource && Date.now() < deadline) {
    // 1. Top up the pool when it can't fill the gap on its own.
    if (pool.length < (minPerSource - matches.length) * 2 && step < plan.length) {
      const s = plan[step++];
      stats.rounds = step;
      say('active', `Round ${step}: searching ${s.why} (${s.queries.slice(0, 4).join(', ')}${s.queries.length > 4 ? '…' : ''})`, counts());
      let raw = [];
      try {
        raw = await withTimeout(prov.collect[platform](s.queries, { depth: s.depth }), Math.max(5000, deadline - Date.now()), `${label} fetch`);
      } catch (err) {
        stats.errors.push(err.message);
        logger.warn({ platform, err: err.message }, 'collector round failed');
        say('warn', `Round ${step} failed: ${err.message}`, counts());
        // Auth / credits errors won't fix themselves; a source that fails
        // twice in a row (after per-call retries) is treated as down.
        if (err.name === 'FatalError' || ++failedInARow >= 2) break;
        continue;
      }
      failedInARow = 0;
      stats.fetched += raw.length;

      // Cheap pass first (ids, ad groups, media URLs) so we only download
      // thumbnails for plausible new videos; then the pHash-aware pass.
      let quickWithin = 0;
      const quickSeen = [];
      const cheap = raw.filter((v) => {
        const sig = { ...signatures(v), phash: null, captionHash: null };
        v.uid = sig.uid;
        if (current.find(sig)) return quickWithin++, false;
        const before = history.find(sig);
        if (before) {
          current.add(sig); // report it once per search
          quickSeen.push({ video: v, ...before });
          return false;
        }
        return true;
      });
      await loadThumbs(cheap);
      const { fresh, within, previouslySeen } = partition(cheap, { history, current });
      stats.duplicatesWithin += within.length + quickWithin;
      stats.previouslySeen += previouslySeen.length + quickSeen.length;
      for (const p of [...quickSeen, ...previouslySeen]) {
        if (seenBefore.length < 40) {
          if (p.uid !== p.video.uid) p.video.thumbRef = p.uid; // show the earlier copy's stored thumbnail
          const last = repo.lastResultFor(p.uid);
          seenBefore.push({ video: p.video, score: last?.score ?? null, reason: last ? `Seen in an earlier search (${p.rule}). ${last.reason || ''}`.trim() : `Seen in an earlier search (${p.rule})`, status: 'previously_seen' });
        }
      }
      for (const v of fresh) v.textScore = textRelevance(v.caption, keywords);
      pool.push(...fresh);
      pool.sort((a, b) => b.textScore - a.textScore);
      say('active', `Round ${step}: ${raw.length} fetched, ${fresh.length} new after de-duplication`, counts());
    }

    if (!pool.length) {
      if (step >= plan.length) break;
      continue;
    }

    // 2. Vision-score the most promising slice of the pool.
    const need = minPerSource - matches.length;
    const take = pool.splice(0, Math.min(pool.length, Math.max(need * 2, 12), maxVisionCandidates));
    say('active', `Scoring ${take.length} videos against the product image`, counts());
    let scores;
    try {
      scores = await prov.score(analysis, image, take);
    } catch (err) {
      stats.errors.push(`scoring: ${err.message}`);
      say('warn', `Vision scoring failed (${err.message}); falling back to caption-only scores`, counts());
      scores = take.map(() => ({ visual: null, reason: 'Vision model unavailable; caption-only score' }));
    }
    stats.scored += take.length;
    take.forEach((v, i) => {
      const s = scores[i];
      const score = combineScore(s.visual, v.textScore);
      const row = { video: v, score, visual: s.visual, reason: `${bandFor(score)}: ${s.reason}`, status: classify(score, matchThreshold) };
      (row.status === 'match' ? matches : low).push(row);
    });
    say('active', `${matches.length}/${minPerSource} matches so far`, counts());
    if (step >= plan.length && !pool.length) break;
  }

  // Leftovers that were never scored are returned to the "unseen" world:
  // drop them from this search's index effect by simply not saving them.
  const shortfall = Math.max(0, minPerSource - matches.length);
  let message;
  if (!shortfall) message = `${matches.length} matching videos found`;
  else if (stats.errors.length && !stats.fetched) message = `Source failed: ${stats.errors[0]}`;
  else {
    message = `Only ${matches.length}/${minPerSource} matches after ${stats.rounds} rounds (${stats.fetched} fetched, ${stats.duplicatesWithin} duplicates, ${stats.previouslySeen} seen before, ${low.length} below the ${matchThreshold} threshold).`;
  }
  say(shortfall ? (matches.length ? 'warn' : 'error') : 'done', message, { ...counts(), shortfall });

  matches.sort((a, b) => b.score - a.score);
  low.sort((a, b) => b.score - a.score);
  return { platform, matches, low, seenBefore, stats: { ...counts(), shortfall, errors: stats.errors, message } };
}

/**
 * @param {string} searchId
 * @param {{keyword?: string, url?: string, image?: {mime, base64, hash}, includeTiktok?: boolean}} input
 */
export async function runSearch(searchId, input, emit) {
  const started = Date.now();
  const prov = providers();
  const stage = (stage, status, message, extra) => emit({ type: 'stage', stage, status, message, ...extra });
  repo.updateSearch(searchId, { status: 'running' });

  try {
    // 1. Resolve the product
    let product;
    if (input.url) {
      stage('resolve', 'active', 'Fetching product page');
      product = await resolveProductUrl(input.url);
      stage('resolve', 'done', `Found "${product.title}" via ${product.resolver}${product.cached ? ' (cached)' : ''}`);
    } else {
      product = { title: input.keyword || 'Uploaded product', description: '', resolver: 'keyword' };
      stage('resolve', 'done', input.keyword ? `Searching for "${input.keyword}"` : 'Using the uploaded image');
    }
    if (input.image) {
      product.image = input.image; // an explicit upload always wins over the page image
      product.imageUrl = null;
    }
    if (input.keyword && input.url) product.title = `${input.keyword} ${product.title}`.trim();

    // 2. Analyse
    stage('analyze', 'active', product.image ? 'Analysing product image' : 'No image: analysing text only (upload a photo for exact matching)');
    const analysis = await prov.analyze({ title: product.title, description: product.description, brand: product.brand, image: product.image });
    const productKey = product.image?.hash || product.sourceUrl || product.title;
    const publicProduct = {
      title: product.title,
      description: product.description,
      brand: product.brand || analysis.brand,
      price: product.price,
      sourceUrl: product.sourceUrl,
      resolver: product.resolver,
      imageUrl: product.imageUrl || null,
      imageData: product.image ? `data:${product.image.mime};base64,${product.image.base64}` : null,
      hasImage: !!product.image,
      analysis,
    };
    repo.updateSearch(searchId, { product: publicProduct, productKey });
    emit({ type: 'product', product: publicProduct });
    stage('analyze', 'done', `Detected: ${analysis.productType}${analysis.colors.length ? `, ${analysis.colors.slice(0, 3).join('/')}` : ''}`);

    // 3. Collect + dedupe + score, sources in parallel and isolated
    const history = repo.loadHistoryIndex(config.pipeline.phashDistance);
    const current = new DedupIndex({ maxDistance: config.pipeline.phashDistance });
    const platforms = ['instagram', 'meta', ...(input.includeTiktok ? ['tiktok'] : [])];
    stage('collect', 'active', `Searching ${platforms.map((p) => SOURCES[p].label).join(', ')}`);
    const ctx = { analysis, image: product.image || null, emit, history, current, prov };
    const settled = await Promise.allSettled(platforms.map((p) => runSource(p, ctx)));

    const perSource = {};
    const rows = [];
    settled.forEach((r, i) => {
      const p = platforms[i];
      if (r.status === 'rejected') {
        logger.error({ err: r.reason, platform: p }, 'source crashed');
        perSource[p] = { matches: 0, low: 0, previouslySeen: 0, shortfall: config.pipeline.minPerSource, errors: [r.reason.message], message: `Source failed: ${r.reason.message}` };
        emit({ type: 'source', platform: p, status: 'error', message: perSource[p].message });
        return;
      }
      const { matches, low, seenBefore, stats } = r.value;
      perSource[p] = stats;
      rows.push(...matches, ...low, ...seenBefore);
    });
    stage('collect', 'done', 'Collection finished');

    // 4. Persist
    stage('save', 'active', 'Saving results');
    for (const row of rows) repo.saveThumb(row.video.uid, row.video.thumb);
    repo.saveResults(searchId, rows);
    const summary = {
      counts: perSource,
      threshold: config.pipeline.matchThreshold,
      minPerSource: config.pipeline.minPerSource,
      mockMode: config.mockMode,
      durationMs: Date.now() - started,
      totalMatches: rows.filter((r) => r.status === 'match').length,
    };
    const anyFailed = platforms.some((p) => perSource[p]?.matches === 0 && SOURCES[p].required);
    repo.updateSearch(searchId, { status: 'done', summary, finishedAt: Date.now() });
    stage('save', 'done', `Done in ${Math.round(summary.durationMs / 1000)}s`);
    emit({ type: 'done', searchId, summary, partial: anyFailed });
  } catch (err) {
    logger.error({ err, searchId }, 'search failed');
    repo.updateSearch(searchId, { status: 'failed', error: err.message, finishedAt: Date.now() });
    stage('error', 'error', err.message);
    throw err;
  }
}
