/**
 * Step 2 of the brain: score each candidate video 0-100 against the product.
 *
 * Hybrid:
 *  1. textRelevance()  – free, local keyword overlap between the caption/ad copy
 *                        and the detected attributes. Used to pre-rank so only
 *                        the most promising candidates reach the vision model.
 *  2. vision score      – Gemini sees the product photo next to a batch of video
 *                        thumbnails and returns a score + reason for each.
 *  3. combineScore()    – 85% visual, 15% text. Visual dominates because the
 *                        brief is "the exact product", and captions lie.
 */
import { config } from '../config.js';
import { clamp, normalizeText } from '../lib/util.js';
import { geminiJson } from './gemini.js';
import { attributeKeywords } from './analyze.js';

export const VISUAL_WEIGHT = 0.85;

export function textRelevance(caption, keywords) {
  if (!keywords.length) return 0;
  const words = new Set(normalizeText(caption).split(' '));
  const raw = String(caption || '').toLowerCase();
  let hits = 0;
  for (const k of keywords) if (words.has(k) || raw.includes(`#${k}`)) hits++;
  // 40% of keywords present is already a strong caption match.
  return Math.round(clamp(hits / Math.max(1, keywords.length * 0.4), 0, 1) * 100);
}

export function combineScore(visual, text) {
  if (visual == null) return Math.round(text * 0.5); // never scored visually: cap at 50
  return Math.round(clamp(VISUAL_WEIGHT * visual + (1 - VISUAL_WEIGHT) * text, 0, 100));
}

export function classify(score, threshold = config.pipeline.matchThreshold) {
  return score >= threshold ? 'match' : 'low';
}

export const SCORE_BANDS = [
  { min: 85, label: 'Exact product' },
  { min: 70, label: 'Very close match' },
  { min: 55, label: 'Likely same product' },
  { min: 35, label: 'Same category, different design' },
  { min: 0, label: 'Unrelated' },
];
export const bandFor = (s) => SCORE_BANDS.find((b) => s >= b.min).label;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER' },
          score: { type: 'INTEGER', description: '0-100' },
          reason: { type: 'STRING', description: 'Max 15 words, concrete visual evidence' },
        },
        required: ['index', 'score', 'reason'],
      },
    },
  },
  required: ['results'],
};

function attributeBlock(a) {
  return [
    `Product: ${a.productType}${a.brand ? ` by ${a.brand}` : ''}`,
    `Colours: ${a.colors.join(', ') || '-'}`,
    `Prints/graphics: ${a.printsOrGraphics.join(', ') || '-'}`,
    `Logos: ${a.logos.join(', ') || '-'}; text on product: ${a.textOnProduct.join(', ') || '-'}`,
    `Material/shape: ${a.material || '-'} / ${a.shape || '-'}`,
    `Distinctive: ${a.distinctiveFeatures.join('; ') || '-'}`,
    `Recognise it by: ${a.summary}`,
  ].join('\n');
}

const RUBRIC = `Score each VIDEO THUMBNAIL for whether it shows THIS EXACT product (not merely the same category):
90-100 the same product: same print/graphic, colours, logo/text and shape
70-89  almost certainly the same product (different angle, partly hidden, worn/used by a person)
55-69  probably the same product but key details are not visible
35-54  same category or style, but a different design/colour/brand
0-34   unrelated, or the product is not visible
Judge the IMAGE first. The caption is weak supporting evidence only. Reasons must cite visual evidence,
e.g. "same skull print and black colour, worn by a model".`;

/**
 * @param {object} analysis   output of analyzeProduct
 * @param {{mime, base64}|null} productImage
 * @param {Array<{caption: string, thumb: {mime, base64}|null}>} candidates
 * @returns {Promise<Array<{visual: number|null, reason: string}>>}
 */
export async function visionScore(analysis, productImage, candidates) {
  const out = new Array(candidates.length).fill(null);
  const batch = config.gemini.scoreBatchSize;
  const batches = [];
  for (let i = 0; i < candidates.length; i += batch) batches.push(i);

  await Promise.all(
    batches.map(async (start) => {
      const slice = candidates.slice(start, start + batch);
      const parts = [
        `${RUBRIC}\n\nREFERENCE PRODUCT\n${attributeBlock(analysis)}`,
      ];
      if (productImage) parts.push('Reference product photo:', productImage);
      else parts.push('(No reference photo; judge against the description above.)');
      const indexMap = [];
      slice.forEach((c, j) => {
        if (!c.thumb) return;
        indexMap.push(j);
        parts.push(`VIDEO ${indexMap.length - 1} caption: ${String(c.caption || '').slice(0, 200)}`, c.thumb);
      });
      if (!indexMap.length) return;
      parts.push(`Return one result per VIDEO index 0..${indexMap.length - 1}.`);
      const { results = [] } = await geminiJson(parts, SCHEMA);
      for (const r of results) {
        const j = indexMap[r.index];
        if (j === undefined) continue;
        out[start + j] = { visual: clamp(Math.round(r.score), 0, 100), reason: String(r.reason || '').slice(0, 160) };
      }
    }),
  );
  return out.map((r) => r || { visual: null, reason: 'Thumbnail unavailable; scored on caption only' });
}

export { attributeKeywords };
