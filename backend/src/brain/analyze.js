/**
 * Step 1 of the brain: read the product (image + any text) and produce
 * structured visual attributes plus platform-specific search terms.
 */
import { config } from '../config.js';
import { cache } from '../db/index.js';
import { sha1, uniq, normalizeText } from '../lib/util.js';
import { geminiJson } from './gemini.js';

const S = (description) => ({ type: 'STRING', description });
const A = (description) => ({ type: 'ARRAY', items: { type: 'STRING' }, description });

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    productType: S('Specific product type, e.g. "oversized crew-neck t-shirt"'),
    category: S('Broad category, e.g. "apparel", "food", "beauty"'),
    colors: A('Dominant colours, most prominent first'),
    printsOrGraphics: A('Prints, patterns or graphics on the product'),
    logos: A('Brand marks or logos visible'),
    textOnProduct: A('Readable text printed on the product or its packaging'),
    material: S('Material or texture'),
    shape: S('Silhouette / form factor / packaging shape'),
    brand: S('Brand name if identifiable, else empty'),
    distinctiveFeatures: A('Details that separate THIS product from look-alikes in its category'),
    summary: S('One sentence a person could use to recognise this exact product in a video frame'),
    metaQueries: A('4-6 short keyword searches for the Meta Ad Library (2-4 words each), most specific first'),
    hashtags: A('8-12 Instagram hashtags without "#", mixing product-specific and niche ones'),
    expandedQueries: A('4-6 broader fallback keyword searches if the specific ones run dry'),
    expandedHashtags: A('8-12 broader fallback hashtags without "#"'),
  },
  required: ['productType', 'colors', 'summary', 'metaQueries', 'hashtags', 'expandedQueries', 'expandedHashtags', 'distinctiveFeatures'],
};

const PROMPT = (ctx) => `You are the visual-analysis brain of a product video discovery tool.
Your output is used to (a) search Instagram Reels and the Meta Ad Library for videos of THIS EXACT product and
(b) later judge whether a video thumbnail shows this exact product. Be concrete and visual.

Context from the user / product page:
- Title or keyword: ${ctx.title || '(none)'}
- Brand: ${ctx.brand || '(unknown)'}
- Description: ${(ctx.description || '(none)').slice(0, 1200)}
${ctx.hasImage ? 'The attached image is the product photo. Base visual attributes on the IMAGE first; use text only to fill gaps.' : 'No image was provided. Infer typical visual attributes from the text and say so in the summary.'}

Search-term rules:
- Indian market: include terms Indian sellers use (e.g. "oversized tee", "combo", "online") where natural.
- Hashtags must be single tokens, lowercase, no spaces, no "#". Avoid generic spam tags like #love #instagood.
- Put the brand in at least one query if known.`;

export async function analyzeProduct({ title, description, brand, image }) {
  const key = `analysis:${config.gemini.model}:${image?.hash || 'noimg'}:${sha1(`${title}|${description}`)}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const parts = [PROMPT({ title, description, brand, hasImage: !!image })];
  if (image) parts.push(image);
  const raw = await geminiJson(parts, SCHEMA, { temperature: 0.2 });
  const result = cleanAnalysis(raw, title);
  cache.set(key, result, config.cache.productTtlMs);
  return result;
}

export function cleanAnalysis(raw, fallbackTitle = '') {
  const tag = (t) => normalizeText(String(t).replace(/^#+/, '')).replace(/\s+/g, '');
  const arr = (a) => uniq((a || []).map((s) => String(s).trim()).filter(Boolean));
  const out = {
    productType: raw.productType || fallbackTitle,
    category: raw.category || '',
    colors: arr(raw.colors),
    printsOrGraphics: arr(raw.printsOrGraphics),
    logos: arr(raw.logos),
    textOnProduct: arr(raw.textOnProduct),
    material: raw.material || '',
    shape: raw.shape || '',
    brand: raw.brand || '',
    distinctiveFeatures: arr(raw.distinctiveFeatures),
    summary: raw.summary || fallbackTitle,
    metaQueries: arr(raw.metaQueries).slice(0, 6),
    hashtags: uniq(arr(raw.hashtags).map(tag)).slice(0, 12),
    expandedQueries: arr(raw.expandedQueries).slice(0, 6),
    expandedHashtags: uniq(arr(raw.expandedHashtags).map(tag)).slice(0, 12),
  };
  if (!out.metaQueries.length && fallbackTitle) out.metaQueries = [fallbackTitle];
  if (!out.hashtags.length && fallbackTitle) out.hashtags = [tag(fallbackTitle)];
  return out;
}

/** Words a matching caption is likely to contain (used for cheap pre-ranking). */
export function attributeKeywords(a) {
  const stop = new Set(['the', 'and', 'with', 'for', 'a', 'an', 'of', 'in', 'on', 'to', 'product']);
  const text = [a.productType, a.brand, ...a.colors, ...a.printsOrGraphics, ...a.logos, ...a.textOnProduct, a.material, ...a.hashtags.slice(0, 6)].join(' ');
  return uniq(normalizeText(text).split(' ').filter((w) => w.length > 2 && !stop.has(w)));
}
