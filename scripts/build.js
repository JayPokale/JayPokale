#!/usr/bin/env node
// Draws the profile README's one image: a split-flap board of live work.
// Rows flip into place once when the page loads, then hold; nothing loops.
// It carries only what GitHub doesn't already show beside the README (name,
// photo, bio, links, pinned repos and the contribution graph live there).
//
// Plain SVG + SMIL, so it animates inside GitHub's <img> sandbox. Base
// attributes are the settled board, so a renderer without SMIL shows that.
//
// Run: GITHUB_TOKEN=... node scripts/build.js <out-dir>
// .github/workflows/profile.yml runs it every 6 hours and publishes `output`.

'use strict';
const fs = require('fs');
const path = require('path');

const LOGIN = 'JayPokale';
// Upstream organisations to feature, in GitHub owner -> board name form.
const ORGS = { ClickHouse: 'CLICKHOUSE', interledger: 'INTERLEDGER', lancedb: 'LANCEDB', 'lance-format': 'LANCEDB', 'ballerina-platform': 'BALLERINA', temporalio: 'TEMPORAL', pydantic: 'PYDANTIC', WICG: 'W3C WICG' };
// The header shows the cliché first, then flips to the claim the rows back up.
const CLICHE = 'Passionate, results-driven, detail-oriented engineer';
const CLAIM = 'Database internals · retrieval security · coding agents';
// Everything below the pull requests: [label, rows of [where, what, status, tone]].
// Thesis lines are as jaypokale.me states them; 63% -> 0% is attack success.
const SECTIONS = [
  ['RESEARCH', [
    ['GRAPHRAG', 'Corroboration Is All You Can Certify', 'IN PROGRESS', 'blue'],
    ['CACHING', 'Cache Me If You Can · attack success', '63% → 0%', 'green'],
    ['CONTINUAL', 'Some Memories Take Time · 9 timescales', 'IN PROGRESS', 'blue'],
  ]],
  ['COMPETITIVE PROGRAMMING', [
    ['LEETCODE', 'Peak rating 2,285 · top 1%', 'GUARDIAN', 'amber'],
    ['CODEFORCES', 'Rating 1,799', 'EXPERT', 'amber'],
  ]],
  ['COMMUNITY', [
    ['DARE2SOLVE', 'Math community · 20,000+ members', 'FOUNDER', 'amber'],
  ]],
];
const MERGED_ROWS = 6, REVIEW_ROWS = 3;
// Board geometry: four fields per row, in characters.
const FIELDS = [6, 11, 39, 11], COLS = FIELDS.reduce((s, n) => s + n, 0) + FIELDS.length - 1;
const W = 880, ADVX = 11.6, GW = COLS * ADVX, X0 = (W - GW) / 2, TH = 25, PITCH = 31, FS = 17;
const C = { housing: '#0b0d10', panel: '#07080a', edge: '#2b3038', seam: '#1d2127', engraving: '#5d6570', text: '#ece8df', amber: '#f0a85a', green: '#3fb950', blue: '#79c0ff' };
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const FLAPS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FRAME = 0.07, SCRAMBLES = 3;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
let seed = 7;
const flap = () => FLAPS[(seed = (seed * 16807) % 2147483647) % FLAPS.length];

// A discrete SMIL timeline that plays once and holds: pts [[seconds, value], ...].
function step(pts) {
  const p = pts[0][0] > 0 ? [[0, pts[0][1]], ...pts] : pts;
  const dur = p[p.length - 1][0];
  return `<animate attributeName="opacity" values="${p.map((x) => x[1]).join(';')}" keyTimes="${p.map((x) => (x[0] / dur).toFixed(4)).join(';')}" dur="${r2(dur)}s" calcMode="discrete" fill="freeze"/>`;
}
// Text pinned to the tiles: one x per character, each centred on its tile, so
// the grid holds whatever monospace font the reader's system substitutes.
const pinned = (s, col, fill, op, a = '') => {
  const cs = [...s];
  return `<text x="${cs.map((_, i) => r1((col + i + 0.5) * ADVX)).join(' ')}" y="${TH / 2 + 6}" fill="${fill}" opacity="${op}">${a}${cs.map((ch) => esc(ch)).join('')}</text>`;
};
// Board space is short: `fix(SplitButton): make…` becomes `SplitButton: make…`.
const tidy = (s) => {
  const m = s.match(/^(?:fix|feat|perf|refactor|chore|test|build|ci)(?:\(([^)]*)\))?!?:\s*(.*)$/i);
  const t = m ? (m[1] ? `${m[1]}: ${m[2]}` : m[2]) : s;
  return t[0].toUpperCase() + t.slice(1);
};
const fit = (s, n) => {
  const cs = [...s];
  return (cs.length > n ? cs.slice(0, n - 1).join('') + '…' : s).padEnd(n);
};

// One field: blank (or `from`) until t0, a few frames of flipping flaps that
// settle left to right, then the text. Returns [svg, time it settles].
function field(text, col, fill, t0, from = '') {
  const to = [...text], was = [...from.padEnd(to.length)];
  const o = [];
  if (from.trim()) o.push(pinned(from, col, fill, 0, step([[0, 1], [t0, 0]])));
  for (let f = 0; f < SCRAMBLES; f++) {
    const keep = Math.floor((to.length * f) / SCRAMBLES);
    const s = to.map((ch, i) => (i < keep ? ch : ch !== ' ' || was[i] !== ' ' ? flap() : ' ')).join('');
    const tf = r2(t0 + f * FRAME);
    o.push(pinned(s, col, fill, 0, step([[0, 0], [tf, 1], [r2(tf + FRAME), 0]])));
  }
  const done = r2(t0 + SCRAMBLES * FRAME);
  o.push(pinned(text, col, fill, 1, step([[0, 0], [done, 1]])));
  return [o.join(''), done];
}

function board(d) {
  const o = [];
  let y = 70, row = 0;
  // Tiles sit inside each row's group, so the pattern starts on the row.
  const tiles = `<rect width="${r1(GW)}" height="${TH}" fill="url(#tiles)"/>`;
  const at = () => r2(0.35 + row++ * 0.07);
  const line = (cells, y) => {
    let col = 0, t = at();
    const parts = cells.map(([s, fill], k) => {
      const [svg] = field(fit(s, FIELDS[k]), col, fill, r2(t + k * 0.04));
      col += FIELDS[k] + 1;
      return svg;
    });
    return `<g transform="translate(${r1(X0)} ${y})">${tiles}${parts.join('')}</g>`;
  };
  const label = (y, left, right = '') => `<text x="${r1(X0)}" y="${y}" font-size="11" letter-spacing="1.6" fill="${C.engraving}">${esc(left)}</text>` +
    (right ? `<text x="${r1(X0 + GW)}" y="${y}" font-size="11" letter-spacing="1.6" fill="${C.engraving}" text-anchor="end">${esc(right)}</text>` : '');

  // Header: the cliché, replaced by the claim once the rows below are up.
  const rowsTotal = d.rows.length + SECTIONS.reduce((s, [, r]) => s + r.length, 0);
  const [hsvg] = field(CLAIM.padEnd(COLS), 0, C.amber, r2(0.35 + rowsTotal * 0.07 + 0.35), CLICHE.padEnd(COLS));
  o.push(`<g transform="translate(${r1(X0)} ${y})">${tiles}${hsvg}</g>`);
  y += TH + 34;

  // Pull requests.
  const by = Object.entries(d.byOrg).sort((a, b) => b[1] - a[1]);
  const orgs = by.slice(0, 3).map(([n, k]) => `${n} ${k}`).join(' · ') + (by.length > 3 ? ` · +${by.length - 3} MORE` : '');
  o.push(label(y - 12, `OPEN SOURCE · ${d.merged} MERGED · ${d.open} IN REVIEW`, orgs));
  for (const p of d.rows) {
    o.push(line([[p.date, C.text], [p.org, C.text], [p.title, C.text], [p.merged ? 'MERGED' : 'IN REVIEW', p.merged ? C.green : C.amber]], y));
    y += PITCH;
  }
  for (const [name, rows] of SECTIONS) {
    y += 30;
    o.push(label(y - 12, name));
    for (const [where, what, status, tone] of rows) {
      o.push(line([['', C.text], [where, C.text], [what, C.text], [status, C[tone]]], y));
      y += PITCH;
    }
  }
  const H = y + 26;
  const screws = [[22, 22], [W - 22, 22], [22, H - 22], [W - 22, H - 22]].map(([cx, cy]) =>
    `<circle cx="${cx}" cy="${cy}" r="4" fill="#1a1d22" stroke="${C.edge}"/><path d="M${cx - 2.4} ${cy - 1.6}l4.8 3.2" stroke="${C.edge}" stroke-width="1.2"/>`).join('');
  const now = new Date();
  const stamp = `UPDATED ${now.getUTCDate()} ${now.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()} ${now.getUTCFullYear()} · ${now.toISOString().slice(11, 16)} UTC`;
  const label2 = `${CLAIM}. Pull requests: ` + d.rows.map((p) => `${p.org} "${p.title}" ${p.merged ? 'merged' : 'in review'} ${p.date}`).join('; ') + '. ' +
    SECTIONS.map(([n, rows]) => `${n}: ` + rows.map(([a, b, c]) => `${a} ${b} ${c}`).join('; ')).join('. ') + '.';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${MONO}" font-size="${FS}" xml:space="preserve" role="img" aria-label="${esc(label2)}">
<defs>
<linearGradient id="flap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3139"/><stop offset="0.49" stop-color="#23272e"/><stop offset="0.51" stop-color="#1a1d23"/><stop offset="1" stop-color="#14161b"/></linearGradient>
<pattern id="tiles" width="${ADVX}" height="${TH}" patternUnits="userSpaceOnUse"><rect x="0.6" width="${r1(ADVX - 1.2)}" height="${TH}" rx="1.8" fill="url(#flap)"/><rect x="0.6" y="${TH / 2 - 0.6}" width="${r1(ADVX - 1.2)}" height="1.2" fill="#000"/><rect x="1.4" y="0.6" width="${r1(ADVX - 2.8)}" height="0.8" fill="#fff" opacity="0.06"/></pattern>
</defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="${C.housing}" stroke="${C.edge}"/>
<rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="12" fill="${C.panel}" stroke="${C.seam}"/>
${screws}
<circle cx="${r1(X0 + 4)}" cy="40" r="4" fill="${C.green}"/><text x="${r1(X0 + 14)}" y="44" font-size="11" letter-spacing="1.6" fill="${C.engraving}">LIVE FROM GITHUB</text>
<text x="${r1(X0 + GW)}" y="44" font-size="11" letter-spacing="1.6" fill="${C.engraving}" text-anchor="end">${esc(stamp)}</text>
${o.join('\n')}
</svg>
`;
}

// ── Data (GitHub API only) ───────────────────────────────────────────────────
async function api(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'profile-art', Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}
// Every pull request matching the search, past the first page of 100.
async function prs(state) {
  const q = encodeURIComponent(`is:pr ${state} author:${LOGIN} -user:${LOGIN}`), items = [];
  for (let page = 1; page <= 10; page++) {
    const r = await api(`https://api.github.com/search/issues?per_page=100&page=${page}&q=${q}`);
    items.push(...r.items);
    if (items.length >= r.total_count || r.items.length < 100) return items;
  }
  throw new Error(`more than 1000 ${state} pull requests`);
}
async function load() {
  const [done, open] = await Promise.all([prs('is:merged'), prs('is:open')]);
  const featured = (items, merged) => items.map((it) => {
    const owner = it.repository_url.split('/repos/')[1].split('/')[0];
    const when = new Date(merged ? it.pull_request.merged_at || it.closed_at : it.created_at);
    return { org: ORGS[owner], merged, when, title: tidy(it.title).replace(/[^\x20-\x7e -ɏ·→…–—]/g, '').trim() };
  }).filter((p) => p.org);
  const m = featured(done, true), r = featured(open, false);
  const byOrg = {};
  for (const p of m) byOrg[p.org] = (byOrg[p.org] || 0) + 1;
  // The board shows recent code changes; docs-only fixes still count above it.
  const recent = (list, n) => list.filter((p) => !/^docs?\b/i.test(p.title)).sort((a, b) => b.when - a.when).slice(0, n);
  const rows = [...recent(m, MERGED_ROWS), ...recent(r, REVIEW_ROWS)].sort((a, b) => b.when - a.when)
    .map((p) => ({ ...p, date: `${String(p.when.getUTCDate()).padStart(2, ' ')} ${p.when.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()}` }));
  return { rows, byOrg, merged: m.length, open: r.length };
}

load().then((d) => {
  const out = path.resolve(process.argv[2] || 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'board.svg'), board(d));
  console.log(`wrote ${out}/board.svg: ${d.merged} merged, ${d.open} in review, ${d.rows.length} rows`);
}).catch((e) => { console.error(e.message); process.exit(1); });
