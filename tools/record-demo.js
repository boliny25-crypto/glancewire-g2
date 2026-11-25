#!/usr/bin/env node
/**
 * Records the GlanceWire demo video (<= 3 minutes, as the hackathon requires)
 * by driving the real app in headless Chrome at the G2's native 576x288 stage
 * size, capturing a CDP screencast and encoding it with ffmpeg.
 *
 * Usage:  node tools/record-demo.js [baseUrl] [outFile]
 * Needs:  a running `node server.js`, ffmpeg on PATH, and a Chrome/Chromium
 *         binary (puppeteer-core uses the local puppeteer cache by default;
 *         override with CHROME_BIN).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = process.argv[3] || path.join(__dirname, '..', 'demo', 'glancewire-demo.mp4');
const FPS = 4; // one frame every 250ms from the capture loop

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  if (fs.existsSync(cache)) {
    for (const ver of fs.readdirSync(cache)) {
      const bin = path.join(cache, ver, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  }
  return '/usr/bin/chromium';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(path.join(__dirname, '..', 'demo'), { recursive: true });
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-frames-'));
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--window-size=640,430'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 430 });

  // Timed-screenshot capture (chrome-headless-shell does not emit CDP
  // screencast frames reliably; a 250ms screenshot loop is deterministic).
  let frame = 0;
  let capturing = true;
  const captureLoop = (async () => {
    while (capturing) {
      try {
        const buf = await page.screenshot({ type: 'png' });
        fs.writeFileSync(path.join(framesDir, `f${String(frame++).padStart(5, '0')}.png`), buf);
      } catch { /* page busy; skip this tick */ }
      await sleep(250);
    }
  })();

  const click = async (act) => { await page.click(`[data-act="${act}"]`); };
  const shot = async (name) => { await page.screenshot({ path: path.join(__dirname, '..', 'demo', name) }); };

  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60_000 });
  await sleep(3500); // home, digest loading
  await shot('shot-home.png');

  await click('go-wire');
  await sleep(4500); // first wire card
  await shot('shot-wire.png');
  await click('next');
  await sleep(3500);
  await click('save');
  await sleep(2500);

  await click('home');
  await sleep(2000);
  await click('go-odds');
  await sleep(4500); // first market card
  await shot('shot-odds.png');
  await click('next');
  await sleep(3000);
  await click('paper-yes');
  await sleep(3500); // confirm screen
  await shot('shot-confirm.png');
  await click('confirm-yes');
  await sleep(4500); // paper book with the new position
  await shot('shot-book.png');

  capturing = false;
  await captureLoop;
  await browser.close();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const enc = spawnSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(framesDir, 'f%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  fs.rmSync(framesDir, { recursive: true, force: true });
  if (enc.status !== 0) { console.error('ffmpeg failed'); process.exit(1); }
  const seconds = frame / FPS;
  console.log(`Demo written to ${OUT} (${frame} frames, ~${seconds.toFixed(0)}s at ${FPS}fps)`);
})().catch((err) => { console.error(err); process.exit(1); });
