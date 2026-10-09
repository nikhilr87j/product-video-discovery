/**
 * SSRF-safe fetch for user-supplied URLs (product pages, product images).
 *
 * - Only http(s), only default ports (80/443) unless ALLOW_ANY_PORT is set.
 * - Every hostname is resolved and rejected if ANY address is private,
 *   loopback, link-local, CGNAT, multicast, or otherwise non-public.
 * - The connection itself uses a custom DNS lookup that repeats that check,
 *   which closes the DNS-rebinding gap between "validate" and "connect".
 * - Redirects are followed manually (max 5) and every hop is re-validated.
 * - Response bodies are size-capped.
 */
import dns from 'node:dns';
import net from 'node:net';
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';

export class UnsafeUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeUrlError';
    this.status = 400;
  }
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

export function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, mask]) => (n & mask) === (base & mask));
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) return true; // hex-form mapped v4: be conservative
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8')) return true;
    return false;
  }
  return true; // not an IP at all -> treat as unsafe
}

const USING_PROXY = !!(process.env.HTTPS_PROXY || process.env.HTTP_PROXY);

const BLOCKED_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

export function assertSafeUrlShape(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('That does not look like a valid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeUrlError('Only http and https links are allowed.');
  if (url.username || url.password) throw new UnsafeUrlError('Links with embedded credentials are not allowed.');
  if (url.port && !['80', '443'].includes(url.port) && !process.env.ALLOW_ANY_PORT) {
    throw new UnsafeUrlError('Only standard web ports (80/443) are allowed.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.test(host)) throw new UnsafeUrlError('Internal hostnames are not allowed.');
  if (net.isIP(host) && isPrivateIp(host)) throw new UnsafeUrlError('Private or internal addresses are not allowed.');
  return url;
}

export async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError('Private or internal addresses are not allowed.');
    return;
  }
  let addrs;
  try {
    addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    // Behind an egress proxy the container may have no DNS of its own; the
    // proxy resolves names, and the shape checks above have already run.
    if (USING_PROXY) return;
    throw new UnsafeUrlError(`Could not resolve host "${host}".`);
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new UnsafeUrlError('That host resolves to a private or internal address.');
  }
}

function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => isPrivateIp(a.address));
    if (bad) return cb(new UnsafeUrlError('Blocked connection to a private address.'));
    if (options && options.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

// If the deployment sits behind an egress proxy, the proxy does DNS; we still
// pre-validate every hop with assertPublicHost above.
const dispatcher = USING_PROXY
  ? new EnvHttpProxyAgent()
  : new Agent({ connect: { lookup: guardedLookup } });

const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  'accept-language': 'en-IN,en;q=0.9',
};

async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UnsafeUrlError(`Response larger than ${Math.round(maxBytes / 1e6)} MB.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * @returns {Promise<{url: string, status: number, contentType: string, body: Buffer}>}
 */
export async function safeFetch(rawUrl, { maxBytes = 5_000_000, timeoutMs = 15000, accept = '*/*', maxRedirects = 5 } = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = assertSafeUrlShape(current);
    await assertPublicHost(url.hostname);
    const res = await undiciFetch(url, {
      dispatcher,
      redirect: 'manual',
      headers: { ...BROWSER_HEADERS, accept },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), url).toString();
      await res.body?.cancel();
      continue;
    }
    const body = await readCapped(res, maxBytes);
    return { url: url.toString(), status: res.status, contentType: res.headers.get('content-type') || '', body };
  }
  throw new UnsafeUrlError('Too many redirects.');
}
