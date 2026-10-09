/**
 * Turns a product URL into { title, description, imageUrl, image } using,
 * in order: Shopify's public product JSON, schema.org JSON-LD, Amazon
 * selectors, OpenGraph tags, and finally <title> + the largest <img>.
 */
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import { safeFetch, UnsafeUrlError } from '../lib/safeFetch.js';
import { cache } from '../db/index.js';
import { config } from '../config.js';
import { sha1, FatalError } from '../lib/util.js';
import { logger } from '../lib/logger.js';

const stripHtml = (html = '') => cheerio.load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

async function tryShopify(url) {
  const m = url.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return null;
  const jsonUrl = `${url.origin}/products/${m[1]}.js`;
  try {
    const res = await safeFetch(jsonUrl, { accept: 'application/json', maxBytes: 3_000_000 });
    if (res.status !== 200 || !res.contentType.includes('json')) return null;
    const p = JSON.parse(res.body.toString('utf8'));
    const img = p.featured_image || p.images?.[0];
    return {
      title: p.title,
      description: stripHtml(p.description),
      imageUrl: img ? new URL(img.startsWith('//') ? `https:${img}` : img, url).toString() : null,
      brand: p.vendor,
      price: p.price ? (p.price / 100).toFixed(2) : undefined,
      resolver: 'shopify-json',
    };
  } catch (err) {
    logger.debug({ err: err.message }, 'shopify json failed');
    return null;
  }
}

function fromJsonLd($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n['@graph']) walk(n['@graph']);
        const t = [].concat(n['@type'] || []);
        if (t.includes('Product') || t.includes('ProductGroup')) nodes.push(n);
      };
      walk(data);
    } catch { /* malformed JSON-LD is common */ }
  });
  const p = nodes[0];
  if (!p) return null;
  let image = p.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === 'object') image = image.url || image.contentUrl;
  const offers = [].concat(p.offers || [])[0];
  return {
    title: p.name,
    description: stripHtml(p.description),
    imageUrl: image,
    brand: typeof p.brand === 'object' ? p.brand?.name : p.brand,
    price: offers?.price,
    resolver: 'json-ld',
  };
}

function fromAmazon($) {
  const title = $('#productTitle').text().trim();
  if (!title) return null;
  const img = $('#landingImage, #imgBlkFront').first();
  let imageUrl = img.attr('data-old-hires');
  if (!imageUrl) {
    try {
      const dyn = JSON.parse(img.attr('data-a-dynamic-image') || '{}');
      imageUrl = Object.entries(dyn).sort((a, b) => b[1][0] - a[1][0])[0]?.[0];
    } catch { /* ignore */ }
  }
  imageUrl ||= img.attr('src');
  const bullets = $('#feature-bullets li').map((_, el) => $(el).text().trim()).get().join(' ');
  return { title, description: bullets, imageUrl, brand: $('#bylineInfo').text().trim(), resolver: 'amazon' };
}

function fromOpenGraph($) {
  const meta = (k) => $(`meta[property="${k}"], meta[name="${k}"]`).attr('content');
  const title = meta('og:title') || meta('twitter:title');
  const imageUrl = meta('og:image:secure_url') || meta('og:image') || meta('twitter:image');
  if (!title && !imageUrl) return null;
  return { title, description: meta('og:description') || meta('description'), imageUrl, resolver: 'opengraph' };
}

function fromFallback($) {
  let best = null;
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    const w = Number($(el).attr('width')) || 0;
    if (src && !src.startsWith('data:') && (!best || w > best.w)) best = { src, w };
  });
  return { title: $('title').text().trim(), description: $('meta[name="description"]').attr('content'), imageUrl: best?.src, resolver: 'fallback' };
}

function looksBlocked(html, status) {
  return status === 403 || status === 429 || status === 503 || /captcha|robot check|access denied|are you a human/i.test(html.slice(0, 20000));
}

/** Merge every extractor's output; the first non-empty value of each field wins. */
export function extractFromHtml(html, baseUrl, seed = null) {
  const $ = cheerio.load(html);
  const candidates = [seed, fromJsonLd($), fromAmazon($), fromOpenGraph($), fromFallback($)].filter(Boolean);
  const product = {};
  for (const c of candidates) {
    for (const [k, v] of Object.entries(c)) if (v && !product[k]) product[k] = v;
  }
  if (product.imageUrl) product.imageUrl = new URL(product.imageUrl, baseUrl).toString();
  return product;
}

/** Download an image (SSRF-safe) and normalise it to a ≤768px JPEG. */
export async function loadImage(imageUrl) {
  const res = await safeFetch(imageUrl, { accept: 'image/*', maxBytes: 12_000_000 });
  if (res.status !== 200) throw new Error(`Image download failed (HTTP ${res.status})`);
  return normaliseImage(res.body);
}

export async function normaliseImage(buffer) {
  const jpeg = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { mime: 'image/jpeg', base64: jpeg.toString('base64'), hash: sha1(jpeg) };
}

/**
 * @returns {Promise<{title, description, imageUrl, brand, price, resolver, sourceUrl, image}>}
 */
export async function resolveProductUrl(rawUrl) {
  const key = `product:${rawUrl}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  const url = new URL(rawUrl);
  let product = await tryShopify(url);

  if (!product?.title || !product?.imageUrl) {
    const res = await safeFetch(rawUrl, { accept: 'text/html,application/xhtml+xml' });
    const html = res.body.toString('utf8');
    if (looksBlocked(html, res.status)) {
      throw new FatalError(
        `The store blocked our page fetch (HTTP ${res.status}). Try again later, or search by product name and upload the product photo instead.`,
        422,
      );
    }
    product = extractFromHtml(html, res.url, product);
  }

  if (!product.title) throw new FatalError('Could not find a product title on that page.', 422);
  if (!product.imageUrl) throw new FatalError('Could not find a product image on that page. Upload the photo instead.', 422);

  const image = await loadImage(product.imageUrl).catch((err) => {
    if (err instanceof UnsafeUrlError) throw err;
    throw new FatalError(`Found the product but could not download its image: ${err.message}`, 422);
  });

  const result = {
    ...product,
    title: clip(product.title, 200),
    description: clip(product.description, 1500),
    sourceUrl: rawUrl,
    image,
  };
  cache.set(key, result, config.cache.productTtlMs);
  return result;
}
