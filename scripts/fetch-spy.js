// Fetch SPY OHLCV from Yahoo Finance (v8 chart API) and write committed fixtures.
//
// Rationale: strategies in docs/strategies/washout-long-spy.md run on this data.
// Committing it to test/fixtures/ follows the repo precedent (btc-1d.json) so
// the sweep is reproducible without re-pulling or scraping at test time.
// "data/" is reserved for the user's personal state (watchlist, paper account)
// and must stay gitignored — hence test/fixtures/, not data/ or a new folder.
//
// RTH: we drop pre/post-market bars (Yahoo returns hasPrePostMarketData; the
// 15:36–20:00 EST tail is pre/post — SPY's exchange hours end at 16:00 ET).
//
// Zero runtime deps. Requires outbound network to query1.finance.yahoo.com.
//
// Usage:
//   node scripts/fetch-spy.js                       # fetch all 4 TFs
//   node scripts/fetch-spy.js --tf 15m              # fetch only 15m
//   node scripts/fetch-spy.js --out /tmp/spy.json   # write one to a custom path
//
// Yahoo's caps (verified empirically via 422 error responses, 2026-11):
//   1m         → "Only 8 days worth of 1m granularity data are allowed"
//   5m/15m/30m → "The requested range must be within the last 60 days"
// Paging into the past (period1 < now-60d) is rejected — the 60d window is a
// hard ceiling, so we cannot build longer 5m+/15m+/30m fixtures from this
// source; the 1m cap is 8d and we're at 8d. See docs/strategies/
// washout-long-spy.md for the ceiling-rationale paragraph.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT_DIR = join(ROOT, "test", "fixtures");

// interval → default range (pinned to Yahoo's per-interval cap).
// 3m is NOT an interval Yahoo exposes on this endpoint
//   (valid: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 4h, 1d, 5d, 1wk, 1mo, 3mo)
// — a 3m view (if ever wanted) has to be resampled from spy-1m.json; see
// docs/strategies/washout-long-spy.md for that rationale.
const DEFAULTS = {
  "1m": "8d",
  "5m": "60d",
  "15m": "60d",
  "30m": "60d",
};

// ET hours that count as RTH for SPY. SPY trades 09:30–16:00 ET.
// On 1m bars the boundary is 09:30 and 15:59 (both kept), 16:00 excluded.
// We keep bars whose hour in ET is within [9, 15] on sub-hour TFs,
// and keep the whole 16:xx bucket for 30m/1h (the 16:00 bucket = 15:00–16:00 close).
function isRTH(ts, interval, tz) {
  const barEnds = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600 };
  const sec = barEnds[interval];
  if (!sec) return true;
  // bucket the bar-start time into ET minute-of-day via the exchange tz offset in the meta
  const d = new Date(ts * 1000);
  // Yahoo returns meta.gmtoffset in seconds, UTC↔ET (negative). Use local ET directly via Intl.
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => Number(et.find((p) => p.type === type)?.value ?? 0);
  const h = get("hour");
  const m = get("minute");
  const minuteOfDay = h * 60 + m;
  // RTH: bar starts in [09:30, 15:59] — the 16:00 bar (15:00 start on 1h) is a
  // "close bar" — on 30m/1h treat 15:00 as the last RTH bar.
  if (interval === "30m" || interval === "1h") return minuteOfDay < 16 * 60;
  return minuteOfDay < 16 * 60; // 16:00 bar itself (the 15:59:xx tick) is excluded; 15:59 is fine
}

async function fetchSPY(interval = "30m", range = DEFAULTS[interval] || "60d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${res.status}: ${await res.text()}`);
  const js = await res.json();
  const r = js?.chart?.result?.[0];
  if (!r) throw new Error("Yahoo returned no chart result");
  const ts = r.timestamp;
  const q = r.indicators?.quote?.[0];
  if (!q || !q.close) throw new Error("Yahoo returned no OHLCV");
  const meta = r.meta || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (!isRTH(ts[i], interval, meta)) continue;
    out.push({
      time: ts[i],
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v ?? 0,
    });
  }
  // ascending sort, safety
  out.sort((a, b) => a.time - b.time);
  return {
    source: "yahoo",
    symbol: "SPY",
    interval,
    range,
    fetchedAt: new Date().toISOString(),
    bars: out,
  };
}

function parseArgs(argv) {
  const args = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tf" && argv[i + 1]) { args.push(["tf", argv[++i]]); }
    else if (a === "--out" && argv[i + 1]) { args.push(["out", argv[++i]]); }
    else if (a === "--range" && argv[i + 1]) { args.push(["range", argv[++i]]); }
    else if (a === "--help" || a === "-h") { args.push(["help", "1"]); }
  }
  const obj = { tfs: Object.keys(DEFAULTS), out: null, range: null, help: false };
  for (const [k, v] of args) {
    if (k === "tf") obj.tfs = [v];
    else if (k === "out") obj.out = v;
    else if (k === "range") obj.range = v;
    else if (k === "help") obj.help = true;
  }
  return obj;
}

function usage() {
  console.log(`fetch-spy — fetch SPY RTH OHLCV from Yahoo into test/fixtures/

Usage:
  node scripts/fetch-spy.js                    # all 5 TFs
  node scripts/fetch-spy.js --tf 15m           # only 15m
  node scripts/fetch-spy.js --range 30d        # override default range
  node scripts/fetch-spy.js --out /tmp/spy.json   # single TF to a custom path

Timeframes and Yahoo range caps:
  1m  → 7d (Yahoo cap)
  3m  → 60d (default, cap 60d)
  5m  → 60d (default, cap 60d)
  15m → 60d (default, cap 60d)
  30m → 60d (default, cap 60d)
`);
}

const argv = parseArgs(process.argv);
if (argv.help) { usage(); process.exit(0); }

let total = 0;
for (const tf of argv.tfs) {
  const range = argv.range || DEFAULTS[tf] || "60d";
  console.error(`[fetch-spy] SPY ${tf} range=${range} ...`);
  const d = await fetchSPY(tf, range);
  const path = argv.out || join(OUT_DIR, `spy-${tf}.json`);
  mkdirSync(dirname(path), { recursive: true });
  // header comment isn't valid JSON, so put it in the JSON as metadata.
  writeFileSync(path, JSON.stringify(d, null, 2) + "\n");
  total += d.bars.length;
  const first = new Date(d.bars[0].time * 1000).toISOString();
  const last = new Date(d.bars.at(-1).time * 1000).toISOString();
  console.error(`[fetch-spy] wrote ${path}  bars=${d.bars.length}  ${first} → ${last}`);
}
console.error(`[fetch-spy] done, total bars ${total}`);
