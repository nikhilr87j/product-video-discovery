import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, assertSafeUrlShape, assertPublicHost, UnsafeUrlError } from '../src/lib/safeFetch.js';

test('private and special addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test('public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '172.32.0.1', '23.227.38.65', '2606:4700::6810:84e5']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('URL shape checks reject unsafe links', () => {
  const bad = ['file:///etc/passwd', 'ftp://example.com', 'http://localhost/x', 'http://127.0.0.1/', 'http://[::1]/', 'http://user:pw@example.com', 'http://example.com:6379/', 'http://metadata.google.internal/', 'not a url'];
  for (const u of bad) assert.throws(() => assertSafeUrlShape(u), UnsafeUrlError, u);
  assert.doesNotThrow(() => assertSafeUrlShape('https://www.example.com/products/tee'));
});

test('hostnames that resolve to private IPs are rejected', async () => {
  await assert.rejects(assertPublicHost('127.0.0.1'), UnsafeUrlError);
  await assert.rejects(assertPublicHost('localhost'), UnsafeUrlError);
});
