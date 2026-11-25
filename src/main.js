/**
 * GlanceWire — a glanceable wire for Even Realities G2.
 *
 * Two live feeds, one glance each:
 *  - WIRE: a digest of the public Telegram channels you follow (Track 01,
 *    Messaging & News — and a Best Telegram Integration entry).
 *  - ODDS: live Polymarket odds with one-tap paper positions (Track 02,
 *    Crypto & DeFi). Paper only: no real funds, per the hackathon rules.
 *
 * Runs as a WebView page inside the Even Realities app. When the Even Hub
 * bridge is present we use it for user info + durable storage; in a plain
 * browser (or the simulator without a bridge) we fall back to localStorage,
 * so the exact same build demos anywhere.
 */
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';

const $ = (sel) => document.querySelector(sel);
const stage = $('#stage');
const statusEl = $('#status');

/* ---------------- storage (bridge when available) ---------------- */

let bridge = null;
const store = {
  async get(key, fallback) {
    try {
      if (bridge) {
        const v = await bridge.getLocalStorage(key);
        if (v !== undefined && v !== null && v !== '') return JSON.parse(v);
      }
    } catch { /* fall through */ }
    try {
      const v = localStorage.getItem('gw:' + key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  async set(key, value) {
    try { if (bridge) await bridge.setLocalStorage(key, JSON.stringify(value)); } catch { /* ignore */ }
    try { localStorage.setItem('gw:' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

/* ---------------- state ---------------- */

const state = {
  view: 'home',
  channels: ['WatcherGuru', 'Cointelegraph', 'durov'],
  digest: [],
  digestIdx: 0,
  markets: [],
  marketIdx: 0,
  saved: [],
  book: null,
  confirm: null, // { market, side, stake }
  notice: '',
};

const STAKES = [10, 25, 50, 100];

function setStatus(msg) { statusEl.textContent = msg || ''; }

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function pct(x) { return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`; }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* ---------------- data ---------------- */

async function loadDigest() {
  setStatus('Loading wire…');
  try {
    const res = await fetch(`/api/digest?channels=${encodeURIComponent(state.channels.join(','))}`);
    const data = await res.json();
    state.digest = data.items || [];
    state.digestIdx = 0;
    setStatus(state.digest.length ? '' : 'No posts found.');
  } catch (err) { setStatus('Wire failed: ' + err.message); }
  render();
}

async function loadMarkets() {
  setStatus('Loading odds…');
  try {
    const res = await fetch('/api/markets');
    const data = await res.json();
    state.markets = data.markets || [];
    state.marketIdx = 0;
    setStatus(state.markets.length ? '' : 'No markets found.');
  } catch (err) { setStatus('Odds failed: ' + err.message); }
  render();
}

async function loadBook() {
  try {
    const res = await fetch('/api/paper');
    state.book = await res.json();
  } catch { state.book = null; }
  render();
}

/* ---------------- views ---------------- */

function header(title, right = '') {
  return `<div class="bar"><span class="title">${esc(title)}</span><span class="right">${esc(right)}</span></div>`;
}

function viewHome() {
  return `
    ${header('GLANCEWIRE', bridge ? 'G2 linked' : 'browser mode')}
    <div class="menu">
      <button data-act="go-wire" class="big">WIRE — Telegram digest</button>
      <button data-act="go-odds" class="big">ODDS — live markets + paper</button>
      <button data-act="go-saved" class="big">SAVED (${state.saved.length})</button>
      <button data-act="go-book" class="big">PAPER BOOK</button>
    </div>
    <div class="hint">One glance, one action. Tap, use arrow keys, or say “next”.</div>`;
}

function viewDigest() {
  if (!state.digest.length) return `${header('WIRE', '0')}<div class="empty">No posts yet. Tap refresh.</div>
    <div class="row"><button data-act="refresh-wire">REFRESH</button><button data-act="home">HOME</button></div>`;
  const item = state.digest[state.digestIdx];
  const isSaved = state.saved.some((s) => s.link === item.link);
  return `
    ${header('WIRE · @' + item.channel, `${state.digestIdx + 1}/${state.digest.length}`)}
    <div class="card">
      <div class="meta">${esc(timeAgo(item.at))}${item.views ? ' · ' + esc(item.views) + ' views' : ''}</div>
      <div class="body">${esc(truncate(item.text, 300))}</div>
    </div>
    <div class="row">
      <button data-act="prev">◀ PREV</button>
      <button data-act="save">${isSaved ? '★ SAVED' : '☆ SAVE'}</button>
      <button data-act="next">NEXT ▶</button>
    </div>
    <div class="row"><button data-act="refresh-wire">REFRESH</button><button data-act="home">HOME</button></div>`;
}

function viewMarkets() {
  if (!state.markets.length) return `${header('ODDS', '0')}<div class="empty">No markets yet. Tap refresh.</div>
    <div class="row"><button data-act="refresh-odds">REFRESH</button><button data-act="home">HOME</button></div>`;
  const m = state.markets[state.marketIdx];
  const chg = m.change24h === null ? '' : ` · 24h ${m.change24h >= 0 ? '+' : ''}${Math.round(m.change24h * 100)} pts`;
  return `
    ${header('ODDS · Polymarket', `${state.marketIdx + 1}/${state.markets.length}`)}
    <div class="card">
      <div class="body q">${esc(truncate(m.question, 140))}</div>
      <div class="odds"><span class="yes">YES ${pct(m.yes)}</span><span class="no">NO ${pct(1 - m.yes)}</span></div>
      <div class="meta">Vol 24h $${m.volume24h.toLocaleString()}${chg}</div>
    </div>
    <div class="row">
      <button data-act="prev">◀ PREV</button>
      <button data-act="paper-yes">PAPER YES</button>
      <button data-act="paper-no">PAPER NO</button>
      <button data-act="next">NEXT ▶</button>
    </div>
    <div class="row"><button data-act="go-book">BOOK</button><button data-act="home">HOME</button></div>`;
}

function viewConfirm() {
  const c = state.confirm;
  if (!c) return viewMarkets();
  const price = c.side === 'YES' ? c.market.yes : 1 - c.market.yes;
  const shares = (c.stake / price).toFixed(1);
  return `
    ${header('CONFIRM PAPER ' + c.side, '')}
    <div class="card">
      <div class="body q">${esc(truncate(c.market.question, 120))}</div>
      <div class="odds"><span>Stake $${c.stake} paper</span><span>@ ${pct(price)}</span><span>≈ ${shares} shares</span></div>
      <div class="meta">Paper trading only — no real funds are used.</div>
    </div>
    <div class="row">
      <button data-act="stake-cycle">STAKE: $${c.stake}</button>
      <button data-act="confirm-yes" class="primary">CONFIRM ✓</button>
      <button data-act="confirm-no">CANCEL</button>
    </div>`;
}

function viewBook() {
  const b = state.book;
  if (!b) return `${header('PAPER BOOK', '')}<div class="empty">Loading…</div>`;
  const rows = b.positions.length
    ? b.positions.map((p) => `<div class="pos"><span>${esc(p.side)} ${esc(truncate(p.question, 44))}</span><span class="${p.pnl >= 0 ? 'up' : 'down'}">${p.pnl >= 0 ? '+' : ''}$${p.pnl}</span></div>`).join('')
    : '<div class="empty">No positions yet. Take a paper position from ODDS.</div>';
  return `
    ${header('PAPER BOOK', `equity $${b.equity}`)}
    <div class="meta">Cash $${b.cash} · ${b.positions.length} open position(s)</div>
    <div class="positions">${rows}</div>
    <div class="row"><button data-act="go-odds">ODDS</button><button data-act="home">HOME</button></div>`;
}

function viewSaved() {
  const rows = state.saved.length
    ? state.saved.map((s, i) => `<div class="pos"><span>@${esc(s.channel)} · ${esc(truncate(s.text, 60))}</span><button data-act="unsave" data-idx="${i}">✕</button></div>`).join('')
    : '<div class="empty">Nothing saved yet. Save a post from WIRE with ☆.</div>';
  return `
    ${header('SAVED', String(state.saved.length))}
    <div class="positions">${rows}</div>
    <div class="row"><button data-act="go-wire">WIRE</button><button data-act="home">HOME</button></div>`;
}

function render() {
  const views = { home: viewHome, wire: viewDigest, odds: viewMarkets, confirm: viewConfirm, book: viewBook, saved: viewSaved };
  stage.innerHTML = (views[state.view] || viewHome)();
  if (state.notice) { setStatus(state.notice); state.notice = ''; }
}

/* ---------------- actions ---------------- */

async function doPaperBuy() {
  const c = state.confirm;
  try {
    const res = await fetch('/api/paper/buy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marketId: c.market.id, side: c.side, stake: c.stake }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'buy failed');
    state.book = data.book;
    state.notice = `Paper ${c.side} taken @ ${pct(c.side === 'YES' ? c.market.yes : 1 - c.market.yes)} for $${c.stake}.`;
    state.view = 'book';
  } catch (err) {
    state.notice = 'Failed: ' + err.message;
    state.view = 'odds';
  }
  state.confirm = null;
  render();
}

async function act(action, el) {
  switch (action) {
    case 'home': state.view = 'home'; render(); break;
    case 'go-wire': state.view = 'wire'; render(); if (!state.digest.length) loadDigest(); break;
    case 'go-odds': state.view = 'odds'; render(); if (!state.markets.length) loadMarkets(); break;
    case 'go-saved': state.view = 'saved'; render(); break;
    case 'go-book': state.view = 'book'; render(); loadBook(); break;
    case 'refresh-wire': loadDigest(); break;
    case 'refresh-odds': loadMarkets(); break;
    case 'next':
      if (state.view === 'wire') state.digestIdx = Math.min(state.digestIdx + 1, state.digest.length - 1);
      if (state.view === 'odds') state.marketIdx = Math.min(state.marketIdx + 1, state.markets.length - 1);
      render(); break;
    case 'prev':
      if (state.view === 'wire') state.digestIdx = Math.max(state.digestIdx - 1, 0);
      if (state.view === 'odds') state.marketIdx = Math.max(state.marketIdx - 1, 0);
      render(); break;
    case 'save': {
      const item = state.digest[state.digestIdx];
      if (item && !state.saved.some((s) => s.link === item.link)) {
        state.saved.unshift({ channel: item.channel, text: item.text, link: item.link, at: item.at });
        await store.set('saved', state.saved);
      }
      render(); break;
    }
    case 'unsave': {
      const idx = Number(el?.dataset.idx);
      if (!Number.isNaN(idx)) { state.saved.splice(idx, 1); await store.set('saved', state.saved); }
      render(); break;
    }
    case 'paper-yes': case 'paper-no': {
      const m = state.markets[state.marketIdx];
      if (m) { state.confirm = { market: m, side: action === 'paper-yes' ? 'YES' : 'NO', stake: 25 }; state.view = 'confirm'; }
      render(); break;
    }
    case 'stake-cycle': {
      const i = STAKES.indexOf(state.confirm.stake);
      state.confirm.stake = STAKES[(i + 1) % STAKES.length];
      render(); break;
    }
    case 'confirm-yes': doPaperBuy(); break;
    case 'confirm-no': state.confirm = null; state.view = 'odds'; render(); break;
    default: break;
  }
}

stage.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn) act(btn.dataset.act, btn);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') act('next');
  else if (e.key === 'ArrowLeft') act('prev');
  else if (e.key === 'Escape') act(state.view === 'confirm' ? 'confirm-no' : 'home');
  else if (e.key === 'Enter' && state.view === 'confirm') act('confirm-yes');
});

/* ---------------- voice (bring-your-own STT hook) ---------------- */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = false;
  $('#mic').addEventListener('click', () => { try { rec.start(); setStatus('Listening…'); } catch { /* already running */ } });
  rec.addEventListener('result', (e) => {
    const said = e.results[0][0].transcript.toLowerCase();
    setStatus(`Heard: “${said}”`);
    if (said.includes('next')) act('next');
    else if (said.includes('back') || said.includes('prev')) act('prev');
    else if (said.includes('save')) act('save');
    else if (said.includes('confirm') || said.includes('yes')) { if (state.view === 'confirm') act('confirm-yes'); else act('paper-yes'); }
    else if (said.includes('cancel') || said.includes('no')) act('confirm-no');
    else if (said.includes('home')) act('home');
    else if (said.includes('refresh')) act(state.view === 'odds' ? 'refresh-odds' : 'refresh-wire');
  });
  rec.addEventListener('error', () => setStatus('Voice unavailable here — tap instead.'));
} else {
  $('#mic').style.display = 'none';
}

/* ---------------- boot ---------------- */

(async function boot() {
  render();
  try {
    bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (bridge) {
      try {
        const user = await bridge.getUserInfo();
        if (user?.name) setStatus(`Welcome, ${user.name}`);
      } catch { /* non-fatal */ }
    }
  } catch { bridge = null; }
  state.saved = await store.get('saved', []);
  state.channels = await store.get('channels', state.channels);
  render();
  loadDigest();
})();
