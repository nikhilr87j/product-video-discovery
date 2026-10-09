/**
 * Runs a set of products through a running API and prints a Markdown report
 * (counts per source, score spread, best and worst matches) for the README.
 *
 *   node scripts/evaluate.js                       # default 5 products
 *   API=http://localhost:4000 node scripts/evaluate.js "query 1" "https://shop/p/2" ...
 */
const API = process.env.API || 'http://localhost:4000';
const DEFAULT_PRODUCTS = [
  'oversized graphic tee',
  'protein dark chocolate',
  'stainless steel insulated water bottle',
  'wireless earbuds with charging case',
  'ceramic hair straightener brush',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(query) {
  const fd = new FormData();
  fd.append('query', query);
  const start = await fetch(`${API}/api/search`, { method: 'POST', body: fd }).then((r) => r.json());
  if (!start.id) throw new Error(start.error || 'search failed to start');
  for (;;) {
    const s = await fetch(`${API}/api/search/${start.id}`).then((r) => r.json());
    if (s.status === 'done' || s.status === 'failed') return s;
    await sleep(2000);
  }
}

const products = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PRODUCTS;
const lines = ['| Product | Instagram matches | Meta matches | Low / rejected | Seen before | Median score | Time |', '|---|---|---|---|---|---|---|'];
const examples = [];

for (const q of products) {
  process.stderr.write(`Searching: ${q}\n`);
  const s = await run(q);
  if (s.status === 'failed') {
    lines.push(`| ${q} | failed: ${s.error} | | | | | |`);
    continue;
  }
  const c = s.summary.counts;
  const matches = s.results.filter((r) => r.status === 'match');
  const scores = matches.map((r) => r.score).sort((a, b) => a - b);
  const median = scores.length ? scores[Math.floor(scores.length / 2)] : '-';
  const low = s.results.filter((r) => r.status === 'low').length;
  const seen = s.results.filter((r) => r.status === 'previously_seen').length;
  const fmt = (x) => (x ? `${x.matches}/${s.summary.minPerSource}${x.shortfall ? ' ⚠' : ''}` : '-');
  lines.push(`| ${q} | ${fmt(c.instagram)} | ${fmt(c.meta)} | ${low} | ${seen} | ${median} | ${Math.round(s.summary.durationMs / 1000)}s |`);
  const best = matches[0];
  const worst = s.results.filter((r) => r.status === 'low').sort((a, b) => b.score - a.score)[0];
  if (best) examples.push(`- **${q}**, good: ${best.score} — ${best.reason} (${best.url})`);
  if (worst) examples.push(`- **${q}**, rejected: ${worst.score} — ${worst.reason} (${worst.url})`);
}

console.log(`Generated ${new Date().toISOString()} against ${API}\n`);
console.log(lines.join('\n'));
console.log('\nExamples\n');
console.log(examples.join('\n'));
