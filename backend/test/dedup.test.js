import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { DedupIndex, partition, signatures, videoUid } from '../src/services/dedup.js';
import { dHash, hamming } from '../src/services/thumbs.js';

const vid = (o) => ({ platform: 'instagram', caption: '', author: 'a', ...o });

test('uid prefers platform id, falls back to media URL hash', () => {
  assert.equal(videoUid(vid({ platformId: '123' })), 'instagram:123');
  const a = videoUid(vid({ mediaUrl: 'https://scontent-bom1.cdninstagram.com/v/x.mp4?sig=1' }));
  const b = videoUid(vid({ mediaUrl: 'https://scontent-del2.cdninstagram.com/v/x.mp4?sig=2' }));
  assert.equal(a, b, 'CDN edge and signature differences must not change identity');
});

test('exact duplicates inside one search are removed', () => {
  const current = new DedupIndex();
  const history = new DedupIndex();
  const r = partition([vid({ platformId: '1' }), vid({ platformId: '1' }), vid({ platformId: '2' })], { current, history });
  assert.equal(r.fresh.length, 2);
  assert.equal(r.within.length, 1);
  assert.equal(r.within[0].rule, 'same id');
});

test('same Meta ad under several ids collapses via collation group', () => {
  const current = new DedupIndex();
  const r = partition(
    [
      { platform: 'meta', platformId: '111', groupKey: 'meta-col:9' },
      { platform: 'meta', platformId: '222', groupKey: 'meta-col:9' },
    ],
    { current, history: new DedupIndex() },
  );
  assert.equal(r.fresh.length, 1);
  assert.equal(r.within[0].rule, 'same ad group');
});

test('same media file under different ids is a duplicate', () => {
  const r = partition(
    [vid({ platformId: 'a', mediaUrl: 'https://cdn.x.com/v/abc.mp4?t=1' }), vid({ platformId: 'b', mediaUrl: 'https://cdn.x.com/v/abc.mp4?t=2' })],
    { current: new DedupIndex(), history: new DedupIndex() },
  );
  assert.equal(r.fresh.length, 1);
  assert.equal(r.within[0].rule, 'same media file');
});

test('videos returned by an earlier search are reported as previously seen', () => {
  const history = new DedupIndex();
  history.add(signatures(vid({ platformId: 'old' })));
  const r = partition([vid({ platformId: 'old' }), vid({ platformId: 'new' })], { current: new DedupIndex(), history });
  assert.deepEqual(r.fresh.map((v) => v.platformId), ['new']);
  assert.equal(r.previouslySeen.length, 1);
});

test('reposts are caught by perceptual hash even with new id and re-encoding', async () => {
  const base = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#223344' } })
    .composite([{ input: Buffer.from('<svg width="200" height="300"><circle cx="70" cy="120" r="50" fill="#f5c542"/><rect x="20" y="230" width="150" height="30" fill="#e11d48"/></svg>') }])
    .png()
    .toBuffer();
  const reencoded = await sharp(base).resize(150).jpeg({ quality: 40 }).toBuffer();
  const different = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#eeeeee' } })
    .composite([{ input: Buffer.from('<svg width="200" height="300"><rect x="120" y="20" width="60" height="200" fill="#111"/></svg>') }])
    .png()
    .toBuffer();
  const [h1, h2, h3] = await Promise.all([dHash(base), dHash(reencoded), dHash(different)]);
  assert.ok(hamming(h1, h2) <= 6, `re-encode distance ${hamming(h1, h2)} should be small`);
  assert.ok(hamming(h1, h3) > 6, `different image distance ${hamming(h1, h3)} should be large`);

  const r = partition([vid({ platformId: 'orig', phash: h1 }), vid({ platformId: 'repost', phash: h2, author: 'b' }), vid({ platformId: 'other', phash: h3 })], {
    current: new DedupIndex({ maxDistance: 6 }),
    history: new DedupIndex(),
  });
  assert.deepEqual(r.fresh.map((v) => v.platformId), ['orig', 'other']);
  assert.equal(r.within[0].rule, 'near-identical thumbnail');
});

test('identical ad copy on a genuinely different creative is NOT merged', () => {
  const copy = 'Shop the oversized tee everyone is talking about. Free shipping across India.';
  const r = partition(
    [
      { platform: 'meta', platformId: '1', caption: copy, author: 'Brand', phash: 'ffff0000ffff0000' },
      { platform: 'meta', platformId: '2', caption: copy, author: 'Brand', phash: '0000ffff0000ffff' },
    ],
    { current: new DedupIndex(), history: new DedupIndex() },
  );
  assert.equal(r.fresh.length, 2);
});

test('same copy + same author + similar frame IS merged (relaunched ad)', () => {
  const copy = 'Shop the oversized tee everyone is talking about. Free shipping across India.';
  const r = partition(
    [
      { platform: 'meta', platformId: '1', caption: copy, author: 'Brand', phash: 'ffff0000ffff0000' },
      { platform: 'meta', platformId: '2', caption: copy, author: 'brand', phash: 'ffff0000ffff00ff' }, // 8 bits off: > 6, ≤ 9
    ],
    { current: new DedupIndex({ maxDistance: 6 }), history: new DedupIndex() },
  );
  assert.equal(r.fresh.length, 1);
  assert.match(r.within[0].rule, /same caption/);
});

test('hamming distance', () => {
  assert.equal(hamming('0000000000000000', '0000000000000000'), 0);
  assert.equal(hamming('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hamming('0000000000000001', '0000000000000003'), 1);
  assert.equal(hamming(null, 'ff'), 64);
});
