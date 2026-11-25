#!/usr/bin/env node
/**
 * GlanceWire — backend for the Even Realities G2 hackathon app.
 *
 * Zero-dependency Node server:
 *  - serves the WebView app from ./public
 *  - GET  /api/digest?channels=a,b,c   -> latest posts from public Telegram
 *                                         channels (via the public t.me/s web
 *                                         preview, no account or key needed)
 *  - GET  /api/markets                 -> top live Polymarket markets
 *                                         (public Gamma API, no key needed)
 *  - GET  /api/paper                   -> paper-trading book (in memory)
 *  - POST /api/paper/buy               -> take a paper position at live odds
 *
 * Per the hackathon money-safety rules this server never touches real funds:
 * Polymarket access is read-only market data and "trading" is a paper book.
 * All external calls happen server-side, so no API keys ever ship in the app.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_CHANNELS = ['WatcherGuru', 'Cointelegraph', 'durov'];
const CACHE_TTL_MS = 60_000;

const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'GlanceWire/0.1 (+hackathon demo)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'GlanceWire/0.1 (+hackathon demo)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/* ---------------- Telegram public channel digest ---------------- */

function decodeEntities(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseChannel(html, channel) {
  const posts = [];
  const blocks = html.split('tgme_widget_message_wrap');
  for (const block of blocks.slice(1)) {
    const textMatch = block.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
    if (!textMatch) continue;
    const text = decodeEntities(textMatch[1]);
    if (!text) continue;
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    const linkMatch = block.match(/tgme_widget_message_date"[^>]*href="([^"]+)"/);
    const viewsMatch = block.match(/tgme_widget_message_views">([^<]+)</);
    posts.push({
      channel,
      text: text.slice(0, 400),
      at: timeMatch ? timeMatch[1] : null,
      link: linkMatch ? linkMatch[1] : `https://t.me/${channel}`,
      views: viewsMatch ? viewsMatch[1] : null,
    });
  }
  return posts;
}

async function getDigest(channels) {
  const key = 'digest:' + channels.join(',');
  return cached(key, CACHE_TTL_MS, async () => {
    const perChannel = await Promise.all(
      channels.map(async (ch) => {
        try {
          const html = await fetchText(`https://t.me/s/${encodeURIComponent(ch)}`);
          return parseChannel(html, ch).slice(-6);
        } catch (err) {
          return [{ channel: ch, text: `Could not load @${ch}: ${err.message}`, at: null, link: `https://t.me/${ch}`, views: null, error: true }];
        }
      })
    );
    const all = perChannel.flat().filter((p) => p.at || p.error);
    all.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    return { channels, items: all.slice(0, 30), fetchedAt: new Date().toISOString() };
  });
}

/* ---------------- Polymarket live markets ---------------- */

async function getMarkets() {
  return cached('markets', CACHE_TTL_MS, async () => {
    const url = 'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=60&order=volume24hr&ascending=false';
    const raw = await fetchJson(url);
    const markets = raw
      .filter((m) => m.question && m.outcomePrices)
      // Skip effectively-settled markets (99%+): a glance at 100/0 odds is useless.
      .filter((m) => { try { const p = Number(JSON.parse(m.outcomePrices)[0]); return p > 0.02 && p < 0.98; } catch { return false; } })
      .slice(0, 12)
      .map((m) => {
        let prices = [];
        try { prices = JSON.parse(m.outcomePrices).map(Number); } catch { /* ignore */ }
        return {
          id: String(m.id),
          question: m.question,
          yes: prices.length ? prices[0] : null,
          change24h: typeof m.oneDayPriceChange === 'number' ? m.oneDayPriceChange : null,
          volume24h: Math.round(Number(m.volume24hr) || 0),
          endDate: m.endDate || null,
          url: m.slug ? `https://polymarket.com/event/${m.slug}` : 'https://polymarket.com',
        };
      })
      .filter((m) => m.yes !== null);
    return { markets, fetchedAt: new Date().toISOString() };
  });
}

/* ---------------- Paper book (no real funds, ever) ---------------- */

const paper = { cash: 1000, positions: [] };

async function paperView() {
  const { markets } = await getMarkets();
  const byId = new Map(markets.map((m) => [m.id, m]));
  let marketValue = 0;
  const positions = paper.positions.map((p) => {
    const live = byId.get(p.marketId);
    const now = live ? (p.side === 'YES' ? live.yes : 1 - live.yes) : p.price;
    const value = p.shares * now;
    marketValue += value;
    return { ...p, nowPrice: now, value: Math.round(value * 100) / 100, pnl: Math.round((value - p.stake) * 100) / 100 };
  });
  return {
    cash: Math.round(paper.cash * 100) / 100,
    positions,
    equity: Math.round((paper.cash + marketValue) * 100) / 100,
  };
}

async function paperBuy(body) {
  const { marketId, side, stake } = body || {};
  const amount = Number(stake);
  if (!marketId || !['YES', 'NO'].includes(side) || !(amount > 0)) throw new Error('marketId, side (YES|NO) and a positive stake are required');
  if (amount > paper.cash) throw new Error('not enough paper cash');
  const { markets } = await getMarkets();
  const market = markets.find((m) => m.id === String(marketId));
  if (!market) throw new Error('market not found or no longer in the top list');
  const price = side === 'YES' ? market.yes : 1 - market.yes;
  const position = {
    marketId: market.id,
    question: market.question,
    side,
    price,
    stake: amount,
    shares: Math.round((amount / price) * 100) / 100,
    at: new Date().toISOString(),
  };
  paper.cash -= amount;
  paper.positions.push(position);
  return position;
}

/* ---------------- HTTP plumbing ---------------- */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/digest') {
      const channels = (url.searchParams.get('channels') || DEFAULT_CHANNELS.join(','))
        .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
      return sendJson(res, 200, await getDigest(channels));
    }
    if (url.pathname === '/api/markets') return sendJson(res, 200, await getMarkets());
    if (url.pathname === '/api/paper' && req.method === 'GET') return sendJson(res, 200, await paperView());
    if (url.pathname === '/api/paper/buy' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const position = await paperBuy(body);
      return sendJson(res, 201, { ok: true, position, book: await paperView() });
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'unknown endpoint' });

    const filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`GlanceWire backend listening on http://localhost:${PORT}`);
});
