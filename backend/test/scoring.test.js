import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textRelevance, combineScore, classify, bandFor, VISUAL_WEIGHT } from '../src/brain/score.js';
import { cleanAnalysis, attributeKeywords } from '../src/brain/analyze.js';
import { queryPlan } from '../src/services/pipeline.js';

const analysis = cleanAnalysis({
  productType: 'oversized graphic t-shirt',
  colors: ['black', 'white'],
  printsOrGraphics: ['skull print'],
  logos: ['Bewakoof'],
  textOnProduct: [],
  summary: 'black oversized tee with a white skull print',
  metaQueries: ['bewakoof skull oversized tee', 'black skull t-shirt', 'oversized graphic tee', 'skull tee online'],
  hashtags: ['#OversizedTee', 'skull tee', 'bewakoof', 'graphictee', 'streetwearindia', 'blacktshirt'],
  expandedQueries: ['oversized t-shirt', 'graphic tee men'],
  expandedHashtags: ['oversizedtshirt', 'tshirtdesign'],
  distinctiveFeatures: ['large white skull on chest'],
});

test('cleanAnalysis normalises hashtags into single lowercase tokens', () => {
  assert.deepEqual(analysis.hashtags.slice(0, 3), ['oversizedtee', 'skulltee', 'bewakoof']);
});

test('caption relevance rewards attribute words and hashtags', () => {
  const kw = attributeKeywords(analysis);
  const good = textRelevance('New black skull print oversized tee from Bewakoof #graphictee', kw);
  const bad = textRelevance('Morning coffee vibes ☕ #mondaymotivation', kw);
  assert.ok(good >= 80, `good caption scored ${good}`);
  assert.equal(bad, 0);
});

test('combined score is dominated by the visual score', () => {
  assert.equal(combineScore(100, 0), Math.round(VISUAL_WEIGHT * 100));
  assert.equal(combineScore(0, 100), Math.round((1 - VISUAL_WEIGHT) * 100));
  // A caption full of the right words cannot rescue the wrong product.
  assert.ok(classify(combineScore(30, 100), 55) === 'low');
  // A great visual match passes even with an empty caption.
  assert.ok(classify(combineScore(80, 0), 55) === 'match');
});

test('videos never scored visually are capped below the default threshold', () => {
  assert.ok(combineScore(null, 100) <= 50);
  assert.equal(classify(combineScore(null, 100), 55), 'low');
});

test('score bands', () => {
  assert.equal(bandFor(95), 'Exact product');
  assert.equal(bandFor(72), 'Very close match');
  assert.equal(bandFor(56), 'Likely same product');
  assert.equal(bandFor(40), 'Same category, different design');
  assert.equal(bandFor(3), 'Unrelated');
});

test('query plan goes specific → expanded → deeper pages', () => {
  const ig = queryPlan('instagram', analysis, 5);
  assert.equal(ig.length, 6);
  assert.deepEqual(ig[0].queries, analysis.hashtags.slice(0, 5));
  assert.equal(ig[0].depth, 0);
  assert.ok(ig[1].queries.includes('oversizedtshirt'));
  assert.ok(ig.slice(2).every((s) => s.depth >= 1));
  const meta = queryPlan('meta', analysis, 1);
  assert.equal(meta.length, 2);
  assert.deepEqual(meta[0].queries, analysis.metaQueries.slice(0, 3));
  assert.ok(meta[1].queries.includes('skull tee online'));
});
