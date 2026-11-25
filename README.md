# GlanceWire — a glanceable wire for Even G2

**Heads Up: Even Realities Hackathon** · Tracks: **01 Messaging & News** + **02 Crypto & DeFi** · Also entered for **Best Telegram Integration**

> Read a new Telegram message, check live odds, act in seconds — without taking
> your phone out of your pocket.

GlanceWire turns the Even G2 into a personal wire service. One glance shows one
thing that matters; one tap (or one short voice command) acts on it:

- **WIRE** — a live digest of the public Telegram channels you follow
  (defaults: @WatcherGuru, @Cointelegraph, @durov — change them in one line).
  Posts are fetched server-side from Telegram's public channel previews, so
  there is **no Telegram account, bot token or API key involved**, and nothing
  private is ever shown: only posts the channels already publish to the world.
  Flip through cards, save the ones that matter, and your saved wire persists
  on the device.
- **ODDS** — live Polymarket odds for the most-traded open markets right now,
  with 24h volume and movement. See a price you like? Take a **paper position**
  in two taps (side → confirm) and watch its P&L in the **PAPER BOOK** against
  live prices. Paper only: this app never touches real funds, exactly as the
  hackathon money-safety rules require.

Everything on screen is **real, live data** — no mocks, no fixtures. If the
network dies, the app says so instead of dressing up stale data.

## Why it fits G2

- Designed natively for the **576 × 288 monochrome green** display: one card,
  big type, zero decoration. What you see in the demo is the actual stage.
- **Read and write**: read a post → save it; read odds → paper-trade them.
  Every flow is glance → one action → done, with smart defaults (a $25 paper
  stake, the freshest post first).
- **Voice-first hooks**: when speech recognition is available, "next", "save",
  "confirm", "refresh" and "home" drive the whole app hands-free. Per the
  platform rules the G2 gives apps raw microphone audio, so production STT is
  bring-your-own (see Feature requests).
- **Even Hub SDK inside**: when the page runs in the Even Realities app it
  connects through `@evenrealities/even_hub_sdk` (`waitForEvenAppBridge`) for
  user info and durable on-device storage. In a plain browser the same build
  falls back to `localStorage`, which is how the demo video was recorded.

## Architecture

```
G2 WebView (public/)            Backend (server.js, zero-dependency Node)
┌──────────────────────┐        ┌───────────────────────────────────────┐
│ index.html + bundle  │  /api  │ /api/digest   -> t.me/s/<channel>     │
│ Even Hub SDK bridge  │ ─────▶ │ /api/markets  -> gamma-api.polymarket │
│ 576×288 mono UI      │        │ /api/paper    -> in-memory paper book │
└──────────────────────┘        └───────────────────────────────────────┘
```

The WebView only ever talks to its own backend (same origin). All third-party
calls happen server-side, so no API keys ship inside the app, and the hosts in
`app.json` are the backend's upstreams.

## Run it

Requirements: Node.js ≥ 20. No other dependencies for the server; the frontend
bundle is prebuilt in `public/app.bundle.js`.

```bash
npm install          # only needed to rebuild the frontend or record the demo
node server.js       # http://localhost:8787
```

Then open <http://localhost:8787> — the page renders the exact 576 × 288 G2
stage. Use the buttons, arrow keys (←/→/Esc/Enter), or the VOICE button.

To try it in the Even Hub simulator:

```bash
npm install -g @evenrealities/evenhub-simulator
node server.js       # in one terminal
evenhub-simulator    # point it at http://localhost:8787
```

To rebuild the frontend after editing `src/main.js`:

```bash
npm run build
```

To re-record the demo video (headless Chrome + ffmpeg, ~40 s):

```bash
npm run demo
```

## Configuration

- **Channels**: edit the defaults in `src/main.js` (`state.channels`) or the
  `DEFAULT_CHANNELS` in `server.js`. Any public Telegram channel works; the
  digest merges the newest posts across channels, newest first.
- **Port**: `PORT=8787 node server.js`.

## What existed before Nov 23

Nothing in this repository. The app, backend, demo tooling and this README were
all written during the hackathon build week (Nov 23–29). The only third-party
pieces are public, pre-existing APIs and libraries: Telegram's public channel
preview pages, Polymarket's public Gamma API, and the open-source
`@evenrealities/even_hub_sdk` (MIT).

## Feature requests for the platform teams (max 5, per the submission rules)

1. **Even Hub**: an on-device or hosted speech-to-text API for WebView apps —
   today every app must ship raw audio to its own server, which is the single
   biggest friction for voice-first G2 apps.
2. **Even Hub**: a documented `app.json` schema reference for network
   whitelisting (we modelled ours on the hackathon brief; a canonical example
   would remove guesswork).
3. **Even Hub**: a headless/CI mode for the simulator, so teams can record demo
   videos and run UI tests without a GUI session.
4. **Telegram**: an official read-only JSON feed for public channels — the
   `t.me/s` HTML preview works, but a stable structured endpoint would make
   digest apps like this one far more robust.
5. **Polymarket**: a `min/max price` filter on the Gamma markets endpoint, so
   clients don't have to fetch-and-filter out effectively-settled markets.

## Safety & privacy

- Paper trading only; no wallets, no keys, no real orders, no financial advice.
- Only *public* Telegram posts are displayed — the same content anyone can open
  at `t.me/<channel>` in a browser.
- No analytics, no tracking, no data leaves the backend except the two public
  API calls above.

## License

MIT
