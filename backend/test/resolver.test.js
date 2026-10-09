import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromHtml } from '../src/services/productResolver.js';

test('JSON-LD product (incl. @graph) wins over OpenGraph', () => {
  const html = `<html><head>
    <meta property="og:title" content="OG title"><meta property="og:image" content="/og.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},
      {"@type":"Product","name":"Skull Oversized Tee","description":"<p>Heavy <b>cotton</b></p>",
       "image":["https://cdn.shop.com/tee.jpg"],"brand":{"@type":"Brand","name":"Acme"},"offers":{"price":"799"}}]}</script>
  </head><body></body></html>`;
  const p = extractFromHtml(html, 'https://shop.com/products/tee');
  assert.equal(p.title, 'Skull Oversized Tee');
  assert.equal(p.description, 'Heavy cotton');
  assert.equal(p.imageUrl, 'https://cdn.shop.com/tee.jpg');
  assert.equal(p.brand, 'Acme');
  assert.equal(p.resolver, 'json-ld');
});

test('OpenGraph fallback resolves relative image URLs', () => {
  const html = '<meta property="og:title" content="Dark Chocolate Protein Bar"><meta property="og:image" content="/img/bar.png"><meta name="description" content="20g protein">';
  const p = extractFromHtml(html, 'https://brand.in/p/bar');
  assert.equal(p.title, 'Dark Chocolate Protein Bar');
  assert.equal(p.imageUrl, 'https://brand.in/img/bar.png');
  assert.equal(p.description, '20g protein');
});

test('Amazon selectors pick the hi-res landing image', () => {
  const html = `<span id="productTitle"> Boat Airdopes 141 </span>
    <img id="landingImage" src="https://m.media-amazon.com/small.jpg" data-old-hires="https://m.media-amazon.com/large.jpg">
    <div id="feature-bullets"><li>42H playback</li><li>ENx tech</li></div>`;
  const p = extractFromHtml(html, 'https://www.amazon.in/dp/X');
  assert.equal(p.title, 'Boat Airdopes 141');
  assert.equal(p.imageUrl, 'https://m.media-amazon.com/large.jpg');
  assert.match(p.description, /42H playback/);
});
