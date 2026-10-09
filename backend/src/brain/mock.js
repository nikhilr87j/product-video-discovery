/**
 * Offline stand-ins for the Gemini brain, used when MOCK_MODE is on.
 * Deterministic, so demos and tests are repeatable.
 */
import { cleanAnalysis } from './analyze.js';
import { normalizeText } from '../lib/util.js';

const COLORS = ['black', 'white', 'navy', 'olive', 'beige', 'maroon', 'pink'];

export async function mockAnalyze({ title, description }) {
  const words = normalizeText(`${title} ${description || ''}`).split(' ').filter((w) => w.length > 2).slice(0, 6);
  const base = words.slice(0, 3).join(' ') || 'product';
  const color = COLORS.find((c) => words.includes(c)) || 'black';
  return cleanAnalysis(
    {
      productType: base,
      category: 'demo',
      colors: [color],
      printsOrGraphics: words.includes('graphic') ? ['front graphic print'] : [],
      logos: [],
      textOnProduct: [],
      material: 'unknown (mock mode)',
      shape: '',
      brand: '',
      distinctiveFeatures: [`${color} ${base}`],
      summary: `A ${color} ${base} (mock analysis: add GEMINI_API_KEY for real vision).`,
      metaQueries: [base, `${base} online`, `${color} ${base}`],
      hashtags: [base.replace(/\s/g, ''), `${base.replace(/\s/g, '')}india`, ...words],
      expandedQueries: [words[0] || base, `${words[0] || base} india`, `buy ${words[0] || base}`],
      expandedHashtags: [`${words[0] || 'product'}lover`, `${words[0] || 'product'}reels`, 'shopindia', 'trendingproducts'],
    },
    title,
  );
}

const REASONS = [
  [85, 'same print, colours and logo as the reference, shown up close'],
  [70, 'same design worn by a model, logo partly hidden'],
  [55, 'matching colour and shape, details too small to confirm'],
  [35, 'same category but a different print and colour'],
  [0, 'product not visible in the frame'],
];

export async function mockVisionScore(_analysis, _image, candidates) {
  return candidates.map((c) => {
    const visual = c.mock?.similarity ?? 40;
    return { visual, reason: `${REASONS.find(([min]) => visual >= min)[1]} (mock)` };
  });
}
