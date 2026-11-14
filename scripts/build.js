#!/usr/bin/env node
// Draws the animated profile art: a -dark and a -light SVG per panel, plus the
// link pills. Live numbers come from the GitHub API only; everything else is
// written below. Plain SVG + SMIL, so it animates inside GitHub's <img> sandbox.
//
// Run: GITHUB_TOKEN=... node scripts/build.js <out-dir>
// .github/workflows/profile.yml runs it every 6 hours and publishes `output`.

'use strict';
const fs = require('fs');
const path = require('path');

const LOGIN = 'JayPokale';
const ROLES = (d) => [
  'researcher @ IIT Hyderabad',
  `creator of Chisle · ${d.chisle.toLocaleString('en-US')} stars`,
  'LeetCode Guardian · Codeforces Expert',
  `${d.clickhouse} merged PRs to ClickHouse`,
  'founder of Dare2Solve · 20k+ community',
];
const CHIPS = ['IIT Hyderabad', 'Top 1% CP', 'Dare2Solve founder'];
// The whoami terminal: [key, value] rows; a key of '' continues the row above.
const ABOUT = [
  ['building', 'Chisle · AI coding agents that talk less, build less, say more'],
  ['research', 'certified defenses for GraphRAG'],
  ['', 'semantic-cache integrity'],
  ['', 'multi-timescale continual learning'],
  ['upstream', 'ClickHouse · LanceDB · Interledger · Temporal · Ballerina'],
  ['ranked', 'LeetCode Guardian (top 1%) · Codeforces Expert'],
  ['founded', 'Dare2Solve · a math community of 20,000+'],
];
const STACK = [['C++', 'TypeScript', 'JavaScript', 'Python', 'Go', 'React'], ['Next.js', 'Node.js', 'Tailwind', 'three.js', 'Docker', 'ClickHouse']];
// Upstream organisations to feature, in GitHub owner -> display name form.
const ORGS = { ClickHouse: 'ClickHouse', interledger: 'Interledger', lancedb: 'LanceDB', 'lance-format': 'LanceDB', 'ballerina-platform': 'Ballerina', temporalio: 'Temporal', pydantic: 'Pydantic', WICG: 'W3C WICG' };
const LINKS = [
  ['site', 'jaypokale.me'], ['linkedin', 'LinkedIn'], ['x', 'X'], ['leetcode', 'LeetCode'],
  ['codeforces', 'Codeforces'], ['devto', 'dev.to'], ['dare2solve', 'Dare2Solve'], ['email', 'Email'],
];

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const ADV = 0.6; // monospace advance per px of font size
const THEMES = {
  dark: { bg: '#0d1117', card: '#161b22', border: '#30363d', text: '#e6edf3', soft: '#c9d1d9', muted: '#8b949e', faint: '#6e7681', accent: '#f0a85a', fill: '#d78a3c', track: '#21262d', dot: '#1f2630', green: '#3fb950', glow: 0.2 },
  light: { bg: '#ffffff', card: '#f6f8fa', border: '#d0d7de', text: '#1f2328', soft: '#31363c', muted: '#59636e', faint: '#818b98', accent: '#b35a14', fill: '#d78a3c', track: '#eaeef2', dot: '#e4e8ec', green: '#1a7f37', glow: 0.12 },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;
const mono = (size) => ` font-family="${MONO}" font-size="${size}"`;
const fmt = (n) => n.toLocaleString('en-US');

// One looping SMIL timeline; pts: [[seconds, value], ...] in time order.
function anim(attr, pts, dur, { ease = false, discrete = false, type } = {}) {
  const p = pts.slice();
  if (p[0][0] > 0) p.unshift([0, p[0][1]]);
  if (p[p.length - 1][0] < dur) p.push([dur, p[p.length - 1][1]]);
  const tag = type ? 'animateTransform' : 'animate';
  let a = `<${tag} attributeName="${attr}"${type ? ` type="${type}"` : ''} values="${p.map((x) => x[1]).join(';')}"` +
    ` keyTimes="${p.map((x) => (x[0] / dur).toFixed(4)).join(';')}" dur="${dur}s" repeatCount="indefinite"`;
  if (discrete) a += ' calcMode="discrete"';
  else if (ease) a += ` calcMode="spline" keySplines="${Array(p.length - 1).fill('0.4 0 0.2 1').join(';')}"`;
  return a + '/>';
}
const shown = (t0, t1, dur, f = 0.3) => anim('opacity', [[t0, 0], [t0 + f, 1], [t1 - f, 1], [t1, 0]], dur);

function svg(t, w, h, label, body, defs = '', rx = 14) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${SANS}" xml:space="preserve" role="img" aria-label="${esc(label)}">
${defs ? `<defs>${defs}</defs>\n` : ''}<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="${t.bg}" stroke="${t.border}"/>
${body.join('\n')}
</svg>
`;
}
const backdrop = (t, w, h, cx = 0.85) =>
  [`<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="${t.dot}"/></pattern>` +
    `<radialGradient id="glow" cx="${cx}" cy="0.2" r="0.7"><stop offset="0" stop-color="${t.fill}" stop-opacity="${t.glow}"/><stop offset="1" stop-color="${t.fill}" stop-opacity="0"/></radialGradient>`,
  `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="url(#dots)"/><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="url(#glow)"/>`];

// ── Hero: avatar with a turning ring, name, typed roles ──────────────────────
function hero(t, d) {
  const W = 880, H = 300, X = 262, Y = 166, FS = 20, CW = FS * ADV, TYPE = 1.1, HOLD = 1.7, DEL = 0.5, SLOT = TYPE + HOLD + DEL + 0.2;
  const roles = ROLES(d), D = r1(SLOT * roles.length);
  const [bgDefs, bg] = backdrop(t, W, H);
  const defs = bgDefs + `<clipPath id="face"><circle cx="130" cy="150" r="80"/></clipPath>` +
    `<linearGradient id="ring" x1="0" x2="1"><stop offset="0" stop-color="${t.fill}"/><stop offset="1" stop-color="${t.fill}" stop-opacity="0"/></linearGradient>` +
    roles.map((r, i) => {
      const t0 = i * SLOT, w = r1((r.length + 2) * CW);
      return `<clipPath id="role${i}"><rect x="${X}" y="${Y - FS}" width="${i === 0 ? w : 0}" height="${FS * 1.5}">` +
        anim('width', [[t0, 0], [t0 + TYPE, w], [t0 + TYPE + HOLD, w], [t0 + TYPE + HOLD + DEL, 0]], D) + '</rect></clipPath>';
    }).join('');
  const o = [bg,
    `<circle cx="130" cy="150" r="92" fill="none" stroke="${t.border}" stroke-width="2"/>`,
    `<circle cx="130" cy="150" r="92" fill="none" stroke="url(#ring)" stroke-width="4" stroke-linecap="round" stroke-dasharray="200 380">` +
      `<animateTransform attributeName="transform" type="rotate" values="0 130 150;360 130 150" dur="6s" repeatCount="indefinite"/></circle>`,
    d.avatar ? `<image href="${d.avatar}" x="50" y="70" width="160" height="160" clip-path="url(#face)"/>` : `<circle cx="130" cy="150" r="80" fill="${t.card}"/>`,
    `<text x="${X}" y="118" font-size="46" font-weight="800" letter-spacing="-1" fill="${t.text}">Jay Pokale</text>`];
  roles.forEach((r, i) => o.push(`<text x="${X}" y="${Y}"${mono(FS)} clip-path="url(#role${i})"><tspan fill="${t.accent}">&gt; </tspan><tspan fill="${t.soft}">${esc(r)}</tspan></text>`));
  // One caret that follows whichever role is being typed, blinking while it holds.
  const cx = [];
  roles.forEach((r, i) => {
    const t0 = i * SLOT, w = (r.length + 2) * CW;
    cx.push([t0, X], [t0 + TYPE, r1(X + w)], [t0 + TYPE + HOLD, r1(X + w)], [t0 + TYPE + HOLD + DEL, X]);
  });
  o.push(`<rect x="${r1(X + (roles[0].length + 2) * CW)}" y="${Y - FS + 2}" width="${r1(CW)}" height="${FS + 3}" fill="${t.accent}">` +
    anim('x', cx, D) + anim('opacity', [[0, 1], [0.5, 0]], 1, { discrete: true }) + '</rect>',
    `<text x="${X}" y="206" font-size="15" fill="${t.muted}">Nagpur, India</text>`);
  let x = X;
  CHIPS.forEach((c, i) => {
    const w = r1(c.length * 12.5 * ADV + 26);
    o.push(`<rect x="${r1(x)}" y="228" width="${w}" height="30" rx="15" fill="${t.card}" stroke="${t.border}"/>` +
      `<rect x="${r1(x)}" y="228" width="${w}" height="30" rx="15" fill="${t.fill}" fill-opacity="0.14" stroke="${t.fill}" opacity="0">${anim('opacity', [[0.6 + i * 0.5, 0], [0.9 + i * 0.5, 1], [1.6 + i * 0.5, 1], [2.1 + i * 0.5, 0]], 5)}</rect>` +
      `<text x="${r1(x + w / 2)}" y="248"${mono(12.5)} fill="${t.soft}" text-anchor="middle">${esc(c)}</text>`);
    x += w + 10;
  });
  return svg(t, W, H, `Jay Pokale. ${roles.join('. ')}. Nagpur, India.`, o, defs);
}

// ── Link pill: one small clickable image per link ────────────────────────────
function pill(t, label, i) {
  const w = Math.round(label.length * 13.5 * ADV + 52), h = 36, D = 6, at = 0.4 + i * 0.45;
  const defs = `<clipPath id="p"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="18"/></clipPath>`;
  const o = [`<circle cx="18" cy="18" r="4" fill="${t.fill}"/>`,
    `<text x="30" y="23"${mono(13.5)} fill="${t.soft}">${esc(label)}</text>`,
    `<text x="${w - 18}" y="23" font-size="13" fill="${t.accent}">↗</text>`,
    `<g clip-path="url(#p)"><rect x="-40" y="0" width="26" height="${h}" fill="${t.accent}" opacity="0.18" transform="skewX(-18)">${anim('x', [[at, -40], [at + 0.8, w + 20]], D, { ease: true })}</rect></g>`];
  return svg(t, w, h, label, o, defs, 18);
}

// ── Stats: four count-up tiles ────────────────────────────────────────────────
function stats(t, d) {
  const W = 880, H = 196, D = 12, tw = 196, gap = 16, x0 = (W - 4 * tw - 3 * gap) / 2;
  const tiles = [
    [d.chisle, (n) => fmt(n), 'stars on Chisle', 'Claude Code plugin'],
    [d.upstream, (n) => fmt(n), 'merged upstream PRs', d.open ? `+${d.open} in review right now` : 'ClickHouse, LanceDB, …'],
    [2285, (n) => fmt(n), 'peak LeetCode rating', 'Guardian · top 1%'],
    [20, (n) => `${n}k+`, 'Dare2Solve community', 'math community I founded'],
  ];
  const o = [];
  tiles.forEach(([n, f, label, sub], i) => {
    const x = x0 + i * (tw + gap);
    o.push(`<rect x="${x}" y="20" width="${tw}" height="156" rx="10" fill="${t.card}" stroke="${t.border}"/>`,
      `<rect x="${x + 18}" y="20" width="40" height="3" rx="1.5" fill="${t.fill}"/>`);
    const F = 14;
    for (let k = 0; k <= F; k++) {
      const v = Math.round(n * (1 - (1 - k / F) ** 3)), t0 = 0.3 + i * 0.15 + k * 0.09;
      const pts = k === 0 ? [[0, 1], [t0 + 0.09, 0], [D - 0.3, 0], [D - 0.29, 1]] : k === F ? [[0, 0], [t0, 1], [D - 0.3, 1], [D - 0.29, 0]] : [[0, 0], [t0, 1], [t0 + 0.09, 0]];
      o.push(`<text x="${x + 18}" y="84" font-size="40" font-weight="800" letter-spacing="-1" fill="${t.accent}" opacity="${k === F ? 1 : 0}">${f(v)}${anim('opacity', pts, D, { discrete: true })}</text>`);
    }
    o.push(`<text x="${x + 18}" y="116" font-size="15" font-weight="600" fill="${t.text}">${esc(label)}</text>`,
      `<text x="${x + 18}" y="140" font-size="12.5" fill="${t.muted}">${esc(sub)}</text>`);
  });
  return svg(t, W, H, `${fmt(d.chisle)} stars on Chisle, ${d.upstream} merged upstream pull requests, peak LeetCode rating 2285, Dare2Solve community of 20k+.`, o);
}

// ── Upstream: merged (solid) and in-review (outlined) PRs per organisation ──
function upstream(t, d) {
  const names = [...new Set(Object.values(ORGS))];
  const rows = names.map((n) => [n, d.merged[n] || 0, d.review[n] || 0]).filter((r) => r[1] + r[2] > 0).sort((a, b) => b[1] + b[2] - (a[1] + a[2]));
  const featured = rows.reduce((s, r) => s + r[1], 0), rest = d.upstream - featured;
  const W = 880, LH = 32, Y0 = 96, H = Y0 + rows.length * LH + (rest > 0 ? 52 : 24), D = 9, X = 200, MAXW = 500, max = Math.max(...rows.map((r) => r[1] + r[2]));
  const o = [`<text x="28" y="44" font-size="20" font-weight="700" fill="${t.text}">${fmt(d.upstream)} merged PRs in other people's repos` +
      (d.open ? `<tspan fill="${t.muted}" font-weight="400"> · </tspan><tspan fill="${t.accent}">${d.open} in review</tspan>` : '') + '</text>',
    `<text x="28" y="70" font-size="13" fill="${t.muted}">live from GitHub ·</text>`,
    `<rect x="136" y="60" width="18" height="11" rx="3" fill="${t.fill}"/><text x="160" y="70" font-size="13" fill="${t.muted}">merged</text>`,
    `<rect x="218" y="60" width="18" height="11" rx="3" fill="${t.fill}" fill-opacity="0.15" stroke="${t.fill}" stroke-dasharray="3 2"/><text x="242" y="70" font-size="13" fill="${t.muted}">in review</text>`];
  rows.forEach(([name, m, r], i) => {
    const y = Y0 + i * LH, wm = r1((m / max) * MAXW), wr = r1((r / max) * MAXW), t0 = 0.4 + i * 0.12, t1 = t0 + 0.9;
    o.push(`<text x="${X - 16}" y="${y + 15}" font-size="14.5" font-weight="${i === 0 ? 700 : 500}" fill="${i === 0 ? t.accent : t.soft}" text-anchor="end">${esc(name)}</text>`);
    if (m) o.push(`<rect x="${X}" y="${y}" width="${wm}" height="20" rx="5" fill="${t.fill}">${anim('width', [[t0, 0], [t1, wm], [D - 0.5, wm], [D - 0.2, 0]], D, { ease: true })}</rect>`);
    if (r) o.push(`<rect x="${r1(X + wm + (m ? 3 : 0))}" y="${y + 0.5}" width="${wr}" height="19" rx="5" fill="${t.fill}" fill-opacity="0.15" stroke="${t.fill}" stroke-dasharray="4 3" opacity="1">` +
      shown(t1, D - 0.3, D, 0.3) + '</rect>');
    const label = (m ? `${m} merged` : '') + (m && r ? ' · ' : '') + (r ? `${r} in review` : '');
    o.push(`<text x="${r1(X + wm + wr + (m && r ? 3 : 0) + 12)}" y="${y + 15}" font-size="13.5" fill="${t.soft}">${shown(t1 - 0.1, D - 0.3, D, 0.25)}${esc(label)}</text>`);
  });
  if (rest > 0) o.push(`<text x="28" y="${H - 22}" font-size="13" fill="${t.faint}">+ ${rest} more merged across ${d.otherRepos} other repos</text>`);
  return svg(t, W, H, `${d.upstream} merged pull requests in other people's repositories and ${d.open} in review: ` + rows.map(([n, m, r]) => `${n} ${m} merged${r ? `, ${r} in review` : ''}`).join('; ') + '.', o);
}

// ── About: a typed `whoami --verbose` ────────────────────────────────────────
function win(t, x, y, w, h, title) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${t.card}" stroke="${t.border}"/>` +
    `<path d="M${x} ${y + 32}H${x + w}" stroke="${t.border}"/>` +
    ['#ff5f57', '#febc2e', '#28c840'].map((c, i) => `<circle cx="${x + 18 + i * 16}" cy="${y + 16}" r="5" fill="${c}"/>`).join('') +
    `<text x="${x + w / 2}" y="${y + 20.5}"${mono(12)} fill="${t.muted}" text-anchor="middle">${esc(title)}</text>`;
}
function about(t) {
  const W = 880, FS = 14, LH = 27, X = 40, Y0 = 84, D = 11, KEY = 11, H = Y0 + ABOUT.length * LH + 44;
  const cmd = 'whoami --verbose', cw = r1((cmd.length + 2) * FS * ADV);
  const o = [win(t, 16, 16, W - 32, H - 32, '~ — zsh'),
    `<clipPath id="typed"><rect x="${X}" y="${Y0 - FS}" width="${cw}" height="${FS * 1.5}">${anim('width', [[0.4, 0], [1.3, cw]], D)}</rect></clipPath>`,
    `<g>${anim('opacity', [[D - 0.5, 1], [D - 0.2, 0]], D)}`,
    `<text x="${X}" y="${Y0}"${mono(FS)} clip-path="url(#typed)"><tspan fill="${t.faint}">$ </tspan><tspan fill="${t.text}">${esc(cmd)}</tspan></text>`,
    `<rect x="${r1(X + cw)}" y="${Y0 - FS + 2}" width="${r1(FS * ADV)}" height="${FS + 3}" fill="${t.soft}" opacity="0">${anim('x', [[0.4, X], [1.3, r1(X + cw)]], D)}${anim('opacity', [[0.39, 0], [0.4, 0.8], [1.6, 0.8], [1.61, 0]], D)}</rect>`];
  ABOUT.forEach(([k, v], i) => {
    const y = Y0 + (i + 1) * LH, at = 1.7 + i * 0.28;
    o.push(`<text x="${X}" y="${y}"${mono(FS)} opacity="1">${anim('opacity', [[at, 0], [at + 0.2, 1]], D)}` +
      `<tspan fill="${t.accent}">${esc(k.padEnd(KEY))}</tspan><tspan fill="${t.soft}">${esc(v)}</tspan></text>`);
  });
  o.push('</g>');
  return svg(t, W, H, 'whoami: ' + ABOUT.map(([k, v]) => (k ? `${k}: ` : '') + v).join('; ') + '.', o);
}

// ── Contributions: the last year, filled in week by week, then chiselled ─────
function contrib(t, d) {
  const W = 880, H = 232, D = 9, C = 11, G = 3, weeks = d.weeks, X0 = Math.round((W - weeks.length * (C + G)) / 2), Y0 = 86;
  const counts = weeks.flatMap((w) => w.map((x) => x.n)).filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p) => counts[Math.floor(p * (counts.length - 1))] || 1;
  const lvl = (n) => (n === 0 ? 0 : n <= q(0.25) ? 1 : n <= q(0.5) ? 2 : n <= q(0.75) ? 3 : 4);
  const op = [0, 0.3, 0.52, 0.76, 1];
  const o = [`<text x="${X0}" y="44" font-size="18" font-weight="700" fill="${t.text}">${fmt(d.contributions)} contributions <tspan fill="${t.muted}" font-weight="400">in the last year</tspan></text>`];
  let last = '';
  weeks.forEach((w, i) => {
    const m = new Date(w[0].date + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    if (m !== last && i < weeks.length - 2) { o.push(`<text x="${X0 + i * (C + G)}" y="${Y0 - 10}" font-size="11" fill="${t.faint}">${m}</text>`); last = m; }
    const at = 0.2 + i * 0.035;
    o.push(`<g opacity="1">${anim('opacity', [[at, 0], [at + 0.25, 1], [D - 0.4, 1], [D - 0.15, 0]], D)}` +
      w.map((x) => `<rect x="${X0 + i * (C + G)}" y="${Y0 + x.day * (C + G)}" width="${C}" height="${C}" rx="2.5" fill="${lvl(x.n) ? t.fill : t.track}"${lvl(x.n) ? ` fill-opacity="${op[lvl(x.n)]}"` : ''}/>`).join('') + '</g>');
  });
  const gx = X0 + weeks.length * (C + G);
  o.push(`<rect x="${X0}" y="${Y0 - 4}" width="4" height="${7 * (C + G) + 4}" rx="2" fill="${t.accent}" opacity="0">` +
    anim('x', [[2.4, X0 - 6], [4.2, gx]], D) + anim('opacity', [[2.39, 0], [2.4, 0.9], [4.2, 0.9], [4.21, 0]], D) + '</rect>');
  const ly = Y0 + 7 * (C + G) + 26;
  o.push(`<text x="${gx - 5 * (C + 4) - 44}" y="${ly + 9}" font-size="11" fill="${t.faint}" text-anchor="end">less</text>`,
    ...op.map((v, k) => `<rect x="${gx - (5 - k) * (C + 4) - 36}" y="${ly}" width="${C}" height="${C}" rx="2.5" fill="${k ? t.fill : t.track}"${k ? ` fill-opacity="${v}"` : ''}/>`),
    `<text x="${gx - 30}" y="${ly + 9}" font-size="11" fill="${t.faint}">more</text>`);
  return svg(t, W, H, `${d.contributions} GitHub contributions in the last year.`, o);
}

// ── Stack: chips lit one after another ───────────────────────────────────────
function stack(t) {
  const W = 880, H = 150, FS = 13.5, GAP = 10, D = 5.4;
  const o = [`<text x="${W / 2}" y="32" font-size="12" font-weight="700" letter-spacing="2" fill="${t.muted}" text-anchor="middle">STACK</text>`];
  let k = 0;
  STACK.forEach((names, r) => {
    const ws = names.map((n) => n.length * FS * ADV + 30);
    let x = (W - ws.reduce((a, b) => a + b, 0) - GAP * (names.length - 1)) / 2;
    names.forEach((n, i) => {
      const at = 0.3 + k++ * 0.3, y = 50 + r * 46;
      o.push(`<rect x="${r1(x)}" y="${y}" width="${r1(ws[i])}" height="34" rx="17" fill="${t.card}" stroke="${t.border}"/>` +
        `<rect x="${r1(x)}" y="${y}" width="${r1(ws[i])}" height="34" rx="17" fill="${t.fill}" fill-opacity="0.12" stroke="${t.fill}" opacity="0">${anim('opacity', [[at, 0], [at + 0.2, 1], [at + 0.7, 1], [at + 1.1, 0]], D)}</rect>` +
        `<text x="${r1(x + ws[i] / 2)}" y="${y + 21.5}"${mono(FS)} fill="${t.soft}" text-anchor="middle">${esc(n)}</text>`);
      x += ws[i] + GAP;
    });
  });
  return svg(t, W, H, 'Stack: ' + STACK.flat().join(', ') + '.', o);
}

// ── Lift: the sign-off ───────────────────────────────────────────────────────
function lift(t) {
  const W = 880, H = 104;
  const bar = `<g>${anim('transform', [[0, '0 6'], [0.7, '0 -10'], [1.3, '0 -10'], [2.0, '0 6'], [2.8, '0 6']], 2.8, { type: 'translate', ease: true })}` +
    `<rect x="38" y="49" width="104" height="5" rx="2.5" fill="${t.soft}"/>` +
    [[46, 30], [56, 22], [124, 22], [132, 30]].map(([x, h]) => `<rect x="${x - 4}" y="${51.5 - h / 2}" width="8" height="${h}" rx="2" fill="${t.fill}"/>`).join('') + '</g>';
  const o = [bar, `<text x="170" y="58" font-size="17" fill="${t.soft}">Powerlifter. <tspan fill="${t.muted}">The only PRs I set without a code review.</tspan></text>`];
  return svg(t, W, H, 'Powerlifter. The only PRs I set without a code review.', o);
}

const LINE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="4" viewBox="0 0 1200 4" preserveAspectRatio="none" role="img" aria-label="divider">
<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#d78a3c" stop-opacity="0"/><stop offset="0.7" stop-color="#f0a85a"/><stop offset="1" stop-color="#fff3e0"/></linearGradient></defs>
<rect width="1200" height="4" rx="2" fill="#d78a3c" opacity="0.18"/>
<rect width="260" height="4" rx="2" fill="url(#g)"><animate attributeName="x" from="-260" to="1200" dur="3.2s" repeatCount="indefinite"/></rect>
</svg>
`;

// ── Data (GitHub API only) ───────────────────────────────────────────────────
async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': 'profile-art', Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, ...init.headers } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res;
}
async function load() {
  const q = `query($l:String!){user(login:$l){avatarUrl(size:320)
    contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date weekday contributionCount}}}}
    repository(name:"Chisle"){stargazerCount}}}`;
  const g = await (await api('https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ query: q, variables: { l: LOGIN } }) })).json();
  if (g.errors) throw new Error(g.errors[0].message);
  const u = g.data.user, cal = u.contributionsCollection.contributionCalendar;
  const prs = async (state) => (await api(`https://api.github.com/search/issues?per_page=100&q=${encodeURIComponent(`is:pr ${state} author:${LOGIN} -user:${LOGIN}`)}`)).json();
  const [done, open] = await Promise.all([prs('is:merged'), prs('is:open')]);
  const tally = (items) => {
    const by = {}, other = new Set();
    for (const it of items) {
      const [owner, repo] = it.repository_url.split('/repos/')[1].split('/');
      if (ORGS[owner]) by[ORGS[owner]] = (by[ORGS[owner]] || 0) + 1; else other.add(`${owner}/${repo}`);
    }
    return [by, other];
  };
  const [merged, other] = tally(done.items), [review] = tally(open.items);
  const img = await api(u.avatarUrl);
  const avatar = `data:${img.headers.get('content-type') || 'image/png'};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
  return {
    avatar, chisle: u.repository.stargazerCount, upstream: done.total_count, open: open.total_count, merged, review, otherRepos: other.size,
    clickhouse: merged.ClickHouse || 0, contributions: cal.totalContributions,
    weeks: cal.weeks.map((w) => w.contributionDays.map((x) => ({ date: x.date, day: x.weekday, n: x.contributionCount }))),
  };
}

load().then((d) => {
  const out = path.resolve(process.argv[2] || 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'line.svg'), LINE);
  for (const [theme, t] of Object.entries(THEMES)) {
    for (const [name, build] of Object.entries({ hero, stats, upstream, about, contrib, stack, lift })) fs.writeFileSync(path.join(out, `${name}-${theme}.svg`), build(t, d));
    LINKS.forEach(([id, label], i) => fs.writeFileSync(path.join(out, `link-${id}-${theme}.svg`), pill(t, label, i)));
  }
  console.log(`wrote ${out}: Chisle ${d.chisle} stars, ${d.upstream} upstream PRs, ${d.contributions} contributions`);
}).catch((e) => { console.error(e.message); process.exit(1); });
