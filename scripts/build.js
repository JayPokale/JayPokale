#!/usr/bin/env node
// Draws the profile art: a -dark and a -light SVG per panel, plus the link
// pills. Live numbers come from the GitHub API only; everything else is written
// below. Plain SVG + SMIL, so it animates inside GitHub's <img> sandbox.
//
// Every animation plays once and holds its last frame. The base attributes are
// that last frame, so a renderer without SMIL shows the finished panel.
//
// Run: GITHUB_TOKEN=... node scripts/build.js <out-dir>
// .github/workflows/profile.yml runs it every 6 hours and publishes `output`.

'use strict';
const fs = require('fs');
const path = require('path');

const LOGIN = 'JayPokale';
// The hero opens on this first draft; a chisel cuts it down to BIO.
const FLUFF = 'Highly passionate, results-driven and detail-oriented engineer who truly loves leveraging cutting-edge technologies to deliver innovative, scalable and high-impact solutions in fast-paced, dynamic environments, always eager to learn, grow and make a real difference.';
const BIO = ['Database internals, retrieval security and coding agents:', 'fixed upstream, proved on paper, starred on GitHub.'];
const ROLE = ['Researcher at IIT Hyderabad', 'Creator of Chisle', 'Nagpur, India'];
// Thesis titles and one-liners, as jaypokale.me states them.
const RESEARCH = [
  ['Corroboration Is All You Can Certify', 'Poison a knowledge graph; I prove how much of the answer is still true.', 'GraphRAG · certified robustness'],
  ['Cache Me If You Can', "Semantic caches can serve an attacker's answer to your question.", ''],
  ['Some Memories Take Time', "Zipf's law fixes how many learning timescales a model needs: about nine.", 'continual learning'],
];
// Chisle's published results: [label, share kept, value].
const CHISLE = [['answer length', 0.55, '−45%'], ['oversized tool output', 0.52, '−48%'], ['graded answers still correct', 1, '156 / 156']];
const STACK = [
  ['languages', ['C++', 'TypeScript', 'Python', 'Go', 'JavaScript', 'LaTeX']],
  ['AI / retrieval', ['RAG', 'hybrid retrieval', 'reranking', 'LLM evals', 'MCP', 'PyTorch']],
  ['web & infra', ['React · Next', 'Node', 'Tailwind', 'three.js', 'Docker', 'Cloudflare Workers']],
];
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
const r2 = (n) => Math.round(n * 100) / 100;
const mono = (size) => ` font-family="${MONO}" font-size="${size}"`;
const fmt = (n) => n.toLocaleString('en-US');
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// One SMIL timeline that plays once and holds its last value.
// pts: [[seconds, value], ...] in time order; it ends at the last point.
// spline: one keySplines entry for every segment, or a single one for all.
function anim(attr, pts, { ease = false, spline, discrete = false, type } = {}) {
  const held = pts[0][0] > 0; // the value holds still until the first point
  const p = held ? [[0, pts[0][1]], ...pts] : pts.slice();
  const dur = p[p.length - 1][0];
  const tag = type ? 'animateTransform' : 'animate';
  let a = `<${tag} attributeName="${attr}"${type ? ` type="${type}"` : ''} values="${p.map((x) => x[1]).join(';')}"` +
    ` keyTimes="${p.map((x) => (x[0] / dur).toFixed(4)).join(';')}" dur="${r2(dur)}s" fill="freeze"`;
  const n = p.length - 1;
  if (discrete) a += ' calcMode="discrete"';
  else if (spline || ease) {
    const s = Array.isArray(spline) ? [...(held ? ['0 0 1 1'] : []), ...spline] : Array(n).fill(spline || '0.4 0 0.2 1');
    a += ` calcMode="spline" keySplines="${s.join(';')}"`;
  }
  return a + '/>';
}
const fadeIn = (t0, f = 0.4) => anim('opacity', [[t0, 0], [t0 + f, 1]], { ease: true });
const riseIn = (t0, dy = 8, f = 0.5) => anim('transform', [[t0, `0 ${dy}`], [t0 + f, '0 0']], { type: 'translate', ease: true });
const FALL = '0.5 0 1 1'; // ease-in, for things dropping away

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
// A regular polygon with a flat top: the avatar is cut, not rounded.
const facets = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => {
  const a = -Math.PI / 2 + Math.PI / n + (i * 2 * Math.PI) / n;
  return `${r1(cx + r * Math.cos(a))},${r1(cy + r * Math.sin(a))}`;
}).join(' ');

// ── Hero: the bio is chiselled from a first draft, then the numbers ─────────
function hero(t, d) {
  const W = 880, H = 420, AX = 124, AY = 136, R = 76, N = 16, X = 236;
  const [bgDefs, bg] = backdrop(t, W, H);
  const ringLen = r1(N * 2 * (R + 9) * Math.sin(Math.PI / N));
  const defs = bgDefs + `<clipPath id="face"><polygon points="${facets(AX, AY, R, N)}"/></clipPath>` +
    `<linearGradient id="blade" x1="0" x2="1"><stop offset="0" stop-color="${t.accent}" stop-opacity="0"/><stop offset="0.5" stop-color="${t.accent}" stop-opacity="0.4"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></linearGradient>`;
  const o = [bg,
    d.avatar ? `<image href="${d.avatar}" x="${AX - R}" y="${AY - R}" width="${2 * R}" height="${2 * R}" preserveAspectRatio="xMidYMid slice" clip-path="url(#face)"/>` : `<polygon points="${facets(AX, AY, R, N)}" fill="${t.card}"/>`,
    `<polygon points="${facets(AX, AY, R + 9, N)}" fill="none" stroke="${t.fill}" stroke-width="1.6" stroke-linejoin="round" stroke-dasharray="${ringLen}" stroke-dashoffset="0">` +
      anim('stroke-dashoffset', [[0.1, ringLen], [1.4, 0]], { ease: true }) + '</polygon>',
    `<text x="${X}" y="98" font-size="44" font-weight="800" letter-spacing="-1" fill="${t.text}">Jay Pokale</text>`,
    `<text x="${X}" y="130" font-size="15" fill="${t.muted}">${ROLE.map(esc).join(`<tspan fill="${t.fill}">  ·  </tspan>`)}</text>`];

  // The draft, word by word, so each word can fall as the chisel passes it.
  const FS = 13.5, CW = FS * ADV, MAXC = Math.floor((W - 40 - X) / CW), LH = 20, FY = 170;
  const lines = [];
  for (const w of FLUFF.split(' ')) {
    const l = lines[lines.length - 1];
    if (!l || l.len + 1 + w.length > MAXC) lines.push({ len: w.length, words: [[w, 0]] });
    else { l.words.push([w, l.len + 1]); l.len += 1 + w.length; }
  }
  const span = MAXC * CW, T0 = 0.9, T1 = 2.1, at = (x) => T0 + ((x - X) / span) * (T1 - T0);
  seed = 11;
  lines.forEach((l, i) => l.words.forEach(([w, c]) => {
    const x = r1(X + c * CW), tw = r2(at(x + (w.length * CW) / 2));
    o.push(`<g opacity="0">${anim('opacity', [[0, 1], [tw, 1], [tw + 0.35, 0]])}` +
      `<g>${anim('transform', [[tw, '0 0'], [tw + 0.45, `${r1(rnd() * 8 - 2)} ${r1(14 + rnd() * 14)}`]], { type: 'translate', spline: FALL })}` +
      `<text x="${x}" y="${FY + i * LH}"${mono(FS)} fill="${t.faint}">${esc(w)}</text></g></g>`);
  }));
  // Chips thrown off the blade.
  const top = FY - 14, bottom = FY + (lines.length - 1) * LH + 4;
  for (let k = 0; k < 26; k++) {
    const ts = r2(T0 + ((k + rnd() * 0.8) * (T1 - T0)) / 26), x = r1(X + ((ts - T0) / (T1 - T0)) * span), y = r1(top + rnd() * (bottom - top));
    const s = 1.8 + rnd() * 3.2, a = rnd() * Math.PI, dx = 6 + rnd() * 22, up = 4 + rnd() * 10, dy = 28 + rnd() * 30;
    const tri = [0, 2.1, 4.3].map((b) => `${r1(s * Math.cos(a + b))},${r1(s * Math.sin(a + b))}`).join(' ');
    o.push(`<g opacity="0">${anim('opacity', [[ts - 0.01, 0], [ts, 1], [ts + 0.45, 0.9], [ts + 0.7, 0]])}` +
      `<g>${anim('transform', [[ts, `${x} ${y}`], [ts + 0.18, `${r1(x + dx * 0.4)} ${r1(y - up)}`], [ts + 0.7, `${r1(x + dx)} ${r1(y + dy)}`]], { type: 'translate', spline: ['0 0 0.6 1', FALL] })}` +
      `<polygon points="${tri}" fill="${k % 3 ? t.muted : t.fill}"/></g></g>`);
  }
  // The blade.
  const by = FY - 24, bh = (lines.length - 1) * LH + 34;
  o.push(`<g opacity="0">${anim('opacity', [[T0 - 0.2, 0], [T0 - 0.05, 1], [T1, 1], [T1 + 0.25, 0]])}` +
    `<g>${anim('transform', [[T0 - 0.05, `${r1(X - 12)} 0`], [T1, `${r1(X + span + 6)} 0`]], { type: 'translate' })}` +
    `<rect x="-16" y="${by}" width="32" height="${bh}" fill="url(#blade)"/>` +
    `<rect x="-1.5" y="${by}" width="3" height="${bh}" rx="1.5" fill="${t.accent}"/>` +
    `<path d="M-6 ${by - 9}h12l-6 9z" fill="${t.accent}"/></g></g>`);
  // What is left.
  BIO.forEach((s, i) => {
    const t0 = T1 + 0.1 + i * 0.18;
    o.push(`<g>${fadeIn(t0, 0.45)}<g>${riseIn(t0)}<text x="${X}" y="${192 + i * 28}" font-size="19" font-weight="${i ? 400 : 650}" fill="${i ? t.soft : t.text}">${esc(s)}</text></g></g>`);
  });
  const n0 = FLUFF.split(' ').length, n1 = BIO.join(' ').split(' ').length;
  o.push(`<text x="${X}" y="254"${mono(12)} fill="${t.faint}">${fadeIn(T1 + 0.6)}chiseled · ${n0} → ${n1} words <tspan fill="${t.accent}">−${Math.round((1 - n1 / n0) * 100)}%</tspan></text>`);

  // The numbers, there from the start.
  o.push(`<path d="M32 282H${W - 32}" stroke="${t.border}"/>`);
  const M = [
    [fmt(d.featured), 'PRs merged upstream', d.open ? `+${d.open} in review` : 'and counting'],
    [fmt(d.chisle), 'stars on Chisle', 'open source · MIT'],
    ['2,285', 'LeetCode peak', 'Guardian · top 1%'],
    ['1,799', 'Codeforces', 'Expert'],
    ['20k+', 'Dare2Solve members', 'a community I founded'],
  ];
  const cw = (W - 64) / M.length;
  M.forEach(([n, label, sub], i) => {
    const x = r1(32 + i * cw);
    if (i) o.push(`<path d="M${r1(x - 16)} 306V390" stroke="${t.border}"/>`);
    o.push(`<g>${fadeIn(0.15 + i * 0.07, 0.5)}` +
      `<text x="${x}" y="340" font-size="30" font-weight="800" letter-spacing="-0.5" fill="${t.accent}">${esc(n)}</text>` +
      `<text x="${x}" y="366" font-size="13" font-weight="600" fill="${t.text}">${esc(label)}</text>` +
      `<text x="${x}" y="386" font-size="12" fill="${t.muted}">${esc(sub)}</text></g>`);
  });
  return svg(t, W, H, `Jay Pokale. ${ROLE.join(', ')}. ${BIO.join(' ')} ` + M.map(([n, l, s]) => `${n} ${l} (${s})`).join(', ') + '.', o, defs);
}

// ── Link pill: one small clickable image per link ────────────────────────────
function pill(t, label, i) {
  const w = Math.round(label.length * 13.5 * ADV + 52), h = 36, at = 0.3 + i * 0.12;
  const defs = `<clipPath id="p"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="18"/></clipPath>`;
  const o = [`<circle cx="18" cy="18" r="4" fill="${t.fill}"/>`,
    `<text x="30" y="23"${mono(13.5)} fill="${t.soft}">${esc(label)}</text>`,
    `<text x="${w - 18}" y="23" font-size="13" fill="${t.accent}">↗</text>`,
    `<g clip-path="url(#p)"><rect x="${w + 20}" y="0" width="26" height="${h}" fill="${t.accent}" opacity="0.18" transform="skewX(-18)">${anim('x', [[at, -40], [at + 0.7, w + 20]], { ease: true })}</rect></g>`];
  return svg(t, w, h, label, o, defs, 18);
}

// ── Upstream: one branch per organisation, one dot per pull request ─────────
function upstream(t, d) {
  const names = [...new Set(Object.values(ORGS))];
  const rows = names.map((n) => [n, d.merged[n] || 0, d.review[n] || 0]).filter((r) => r[1] + r[2] > 0).sort((a, b) => b[1] - a[1] || b[2] - a[2]);
  const W = 880, Y0 = 104, LH = 34, H = Y0 + rows.length * LH + 40, SX = 64, SY = r1(Y0 + ((rows.length - 1) * LH) / 2), LX = 196, DX = 324, DXE = 660;
  const most = Math.max(...rows.map((r) => r[1] + r[2])), gap = Math.min(13, (DXE - DX) / Math.max(most - 1, 1));
  const o = [`<text x="32" y="48" font-size="20" font-weight="700" fill="${t.text}">Merged upstream <tspan font-size="13" font-weight="400" fill="${t.muted}">· live from GitHub</tspan></text>`,
    `<circle cx="${W - 200}" cy="42" r="4.2" fill="${t.fill}"/><text x="${W - 189}" y="46.5" font-size="12.5" fill="${t.muted}">merged</text>`,
    `<circle cx="${W - 120}" cy="42" r="3.6" fill="${t.bg}" stroke="${t.fill}" stroke-width="1.4"/><text x="${W - 109}" y="46.5" font-size="12.5" fill="${t.muted}">in review</text>`];
  rows.forEach(([name, m, r], i) => {
    const y = Y0 + i * LH, tb = 0.25 + i * 0.08;
    const c = [[SX + 9, SY], [SX + 70, SY], [LX - 70, y], [LX, y]];
    let len = 0;
    for (let k = 1, [px, py] = c[0]; k <= 40; k++) {
      const s = k / 40, u = 1 - s;
      const qx = u * u * u * c[0][0] + 3 * u * u * s * c[1][0] + 3 * u * s * s * c[2][0] + s * s * s * c[3][0];
      const qy = u * u * u * c[0][1] + 3 * u * u * s * c[1][1] + 3 * u * s * s * c[2][1] + s * s * s * c[3][1];
      len += Math.hypot(qx - px, qy - py); px = qx; py = qy;
    }
    len = r1(len + 1);
    o.push(`<path d="M${c[0].join(' ')}C${c.slice(1).map((p) => p.join(' ')).join(' ')}" fill="none" stroke="${t.fill}" stroke-opacity="${i ? 0.45 : 0.9}" stroke-width="${i ? 1.6 : 2.2}" stroke-dasharray="${len}" stroke-dashoffset="0">` +
      anim('stroke-dashoffset', [[tb, len], [tb + 0.5, 0]], { ease: true }) + '</path>',
      `<text x="${LX + 12}" y="${y + 5}" font-size="14" font-weight="${i ? 500 : 700}" fill="${i ? t.soft : t.text}">${fadeIn(tb + 0.35, 0.3)}${esc(name)}</text>`);
    const n = m + r, end = r1(DX + (n - 1) * gap);
    o.push(`<path d="M${DX - 14} ${y}H${r1(end + 14)}" stroke="${t.track}" stroke-width="1.5" stroke-dasharray="${r1(end - DX + 28)}" stroke-dashoffset="0">${anim('stroke-dashoffset', [[tb + 0.45, r1(end - DX + 28)], [tb + 0.45 + n * 0.028, 0]])}</path>`);
    for (let j = 0; j < n; j++) {
      const tj = r2(tb + 0.5 + j * 0.028), cx = r1(DX + j * gap), big = j < m ? 4.2 : 3.6;
      o.push(j < m
        ? `<circle cx="${cx}" cy="${y}" r="${big}" fill="${t.fill}">${anim('r', [[tj, 0], [tj + 0.12, 5.6], [tj + 0.22, big]])}</circle>`
        : `<circle cx="${cx}" cy="${y}" r="${big}" fill="${t.bg}" stroke="${t.fill}" stroke-width="1.4">${anim('r', [[tj, 0], [tj + 0.12, 5], [tj + 0.22, big]])}</circle>`);
    }
    o.push(`<text x="${W - 32}" y="${y + 5}" font-size="13" fill="${t.muted}" text-anchor="end">${fadeIn(r2(tb + 0.5 + n * 0.028), 0.3)}` +
      (m ? `<tspan font-weight="700" fill="${t.text}">${m}</tspan> merged` : '') + (m && r ? ' · ' : '') + (r ? `<tspan fill="${t.accent}">${r}</tspan> in review` : '') + '</text>');
  });
  o.push(`<g transform="translate(${SX} ${SY})"><g>${anim('transform', [[0.05, 0], [0.3, 1.25], [0.45, 1]], { type: 'scale', ease: true })}` +
    `<circle r="10" fill="${t.fill}"/><circle r="4" fill="${t.bg}"/></g></g>`,
    `<text x="${SX}" y="${SY + 30}"${mono(11)} fill="${t.faint}" text-anchor="middle">@${LOGIN}</text>`);
  const rest = d.upstream - d.featured;
  if (rest > 0) o.push(`<text x="32" y="${H - 20}" font-size="12.5" fill="${t.faint}">+ ${rest} more merged across ${d.otherRepos} other repos · ${d.upstream} in all</text>`);
  return svg(t, W, H, `Pull requests merged upstream, live from GitHub: ` + rows.map(([n, m, r]) => `${n} ${m} merged${r ? `, ${r} in review` : ''}`).join('; ') + (rest > 0 ? `; ${rest} more across ${d.otherRepos} other repos.` : '.'), o);
}

// ── Chisle: the project and its published results ───────────────────────────
function chisle(t, d) {
  const W = 880, H = 232, BX = 476, BW = W - 32 - BX;
  const o = [`<text x="32" y="78"${mono(42)} font-weight="700" letter-spacing="-1" fill="${t.text}">chisle</text>`,
    `<rect x="${r1(32 + 6 * 42 * ADV - 5 + 8)}" y="46" width="16" height="38" rx="2" fill="${t.fill}"/>`,
    `<text x="32" y="116" font-size="15" fill="${t.soft}">Makes AI coding agents talk less, build less,</text>`,
    `<text x="32" y="138" font-size="15" fill="${t.soft}">read less and say more.</text>`,
    `<text x="32" y="176"${mono(12.5)} fill="${t.muted}"><tspan fill="${t.accent}"><tspan font-family="${SANS}">★</tspan> ${fmt(d.chisle)}</tspan> stars  ·  npx chisle  ·  13 agents  ·  MIT</text>`,
    `<text x="32" y="204" font-size="12" fill="${t.faint}">The only tool in its class that publishes the benchmarks it loses.</text>`,
    `<text x="${BX}" y="40" font-size="11" font-weight="700" letter-spacing="1.5" fill="${t.faint}">PUBLISHED RESULTS</text>`];
  CHISLE.forEach(([label, keep, value], i) => {
    const y = 74 + i * 52, kw = r1(BW * keep), tc = 0.7 + i * 0.35, whole = keep === 1;
    o.push(`<text x="${BX}" y="${y}" font-size="13" fill="${t.soft}">${esc(label)}</text>`,
      `<rect x="${BX}" y="${y + 10}" width="${BW}" height="10" rx="5" fill="${t.track}"/>`);
    if (whole) o.push(`<rect x="${BX}" y="${y + 10}" width="${BW}" height="10" rx="5" fill="${t.green}">${anim('width', [[tc, 0], [tc + 0.7, BW]], { ease: true })}</rect>`);
    else {
      o.push(`<rect x="${BX}" y="${y + 10}" width="${kw}" height="10" rx="5" fill="${t.fill}"/>`,
        // The part chiselled off: whole at first, then knocked away.
        `<g opacity="0">${anim('opacity', [[0, 1], [tc, 1], [tc + 0.45, 0]])}<g>${anim('transform', [[tc, '0 0'], [tc + 0.5, '6 16']], { type: 'translate', spline: FALL })}` +
          `<rect x="${r1(BX + kw + 1)}" y="${y + 10}" width="${r1(BW - kw - 1)}" height="10" rx="5" fill="${t.fill}"/></g></g>`,
        `<rect x="${r1(BX + kw - 1)}" y="${y + 4}" width="2" height="22" rx="1" fill="${t.accent}" opacity="0">${anim('opacity', [[tc - 0.12, 0], [tc - 0.05, 1], [tc + 0.25, 0]])}</rect>`);
    }
    o.push(`<text x="${W - 32}" y="${y}" font-size="13" font-weight="700" fill="${whole ? t.green : t.accent}" text-anchor="end">${fadeIn(tc + 0.2)}${esc(value)}</text>`);
  });
  return svg(t, W, H, `Chisle: makes AI coding agents talk less, build less, read less and say more. ${fmt(d.chisle)} stars, 13 agents, MIT. Answers 45% shorter, oversized tool output cut 48%, 156 of 156 graded answers still correct.`, o);
}

// ── Research: the three theses ───────────────────────────────────────────────
function research(t) {
  const W = 880, Y0 = 100, LH = 66, H = Y0 + RESEARCH.length * LH - 10;
  const o = [`<text x="32" y="48" font-size="20" font-weight="700" fill="${t.text}">Research <tspan font-size="13" font-weight="400" fill="${t.muted}">· IIT Hyderabad · three theses in progress</tspan></text>`];
  RESEARCH.forEach(([title, line, tag], i) => {
    const y = Y0 + i * LH, t0 = 0.2 + i * 0.16;
    o.push(`<rect x="32" y="${y - 17}" width="3" height="44" rx="1.5" fill="${t.fill}">${anim('height', [[t0, 0], [t0 + 0.45, 44]], { ease: true })}</rect>`,
      `<g>${fadeIn(t0 + 0.1)}<g>${riseIn(t0 + 0.1, 6)}` +
        `<text x="50" y="${y}" font-size="16" font-weight="700" fill="${t.text}">“${esc(title)}”</text>` +
        `<text x="50" y="${y + 22}" font-size="13.5" fill="${t.soft}">${esc(line)}</text></g></g>`);
    if (tag) o.push(`<text x="${W - 32}" y="${y}"${mono(11.5)} fill="${t.faint}" text-anchor="end">${fadeIn(t0 + 0.3)}${esc(tag)}</text>`);
  });
  // Attack success on the semantic cache, before and after the fix, counted down.
  const y = Y0 + LH, FS = 20, C = FS * ADV, x0 = r1(W - 32 - 9 * C), tc = 0.9, steps = [63, 48, 34, 22, 12, 5, 1, 0];
  o.push(`<text x="${W - 32}" y="${y}"${mono(11.5)} fill="${t.faint}" text-anchor="end">attack success</text>`,
    `<text x="${x0}" y="${y + 25}"${mono(FS)} fill="${t.muted}">63%</text>`,
    `<path d="M${x0 - 2} ${y + 18}H${r1(x0 + 3 * C + 2)}" stroke="${t.muted}" stroke-width="1.6" stroke-dasharray="${r1(3 * C + 4)}" stroke-dashoffset="0">${anim('stroke-dashoffset', [[tc + steps.length * 0.09, r1(3 * C + 4)], [tc + steps.length * 0.09 + 0.25, 0]])}</path>`,
    `<text x="${r1(x0 + 4 * C)}" y="${y + 25}"${mono(FS)} fill="${t.faint}">→</text>`);
  steps.forEach((v, k) => {
    const tk = r2(tc + k * 0.09), last = k === steps.length - 1;
    const pts = k === 0 ? [[0, 1], [tk + 0.09, 0]] : last ? [[0, 0], [tk, 1]] : [[0, 0], [tk, 1], [tk + 0.09, 0]];
    o.push(`<text x="${r1(x0 + 6 * C)}" y="${y + 25}"${mono(FS)} font-weight="700" fill="${t.green}" opacity="${last ? 1 : 0}">${anim('opacity', pts, { discrete: true })}${v}%</text>`);
  });
  return svg(t, W, H, 'Research at IIT Hyderabad, three theses in progress: ' + RESEARCH.map(([a, b]) => `"${a}": ${b}`).join(' ') + ' Attack success on the semantic cache: 63% to 0%.', o);
}

// ── Toolbox: labelled rows of chips ─────────────────────────────────────────
function stack(t) {
  const W = 880, FS = 13, GAP = 8, X = 170, H = 70 + STACK.length * 44;
  const o = [`<text x="32" y="40" font-size="12" font-weight="700" letter-spacing="2" fill="${t.muted}">TOOLBOX</text>`];
  let k = 0;
  STACK.forEach(([label, names], r) => {
    const y = 58 + r * 44;
    o.push(`<text x="32" y="${y + 21}"${mono(12.5)} fill="${t.faint}">${esc(label)}</text>`);
    let x = X;
    names.forEach((n) => {
      const w = r1(n.length * FS * ADV + 26);
      o.push(`<g>${fadeIn(r2(0.15 + k++ * 0.05), 0.35)}<rect x="${r1(x)}" y="${y}" width="${w}" height="32" rx="16" fill="${t.card}" stroke="${t.border}"/>` +
        `<text x="${r1(x + w / 2)}" y="${y + 20.5}"${mono(FS)} fill="${t.soft}" text-anchor="middle">${esc(n)}</text></g>`);
      x += w + GAP;
    });
  });
  return svg(t, W, H, 'Toolbox. ' + STACK.map(([l, n]) => `${l}: ${n.join(', ')}`).join('. ') + '.', o);
}

// ── Closing: the invitation ─────────────────────────────────────────────────
function closing(t) {
  const W = 880, H = 152;
  const o = [`<text x="32" y="60" font-size="22" font-weight="800" letter-spacing="-0.3" fill="${t.text}">Every problem here started unsolved.</text>`,
    `<path d="M32 78H96" stroke="${t.fill}" stroke-width="3" stroke-linecap="round" stroke-dasharray="64" stroke-dashoffset="0">${anim('stroke-dashoffset', [[0.3, 64], [0.9, 0]], { ease: true })}</path>`,
    `<text x="32" y="108" font-size="16" fill="${t.soft}">If yours is interesting enough, it won't stay that way.</text>`,
    `<text x="32" y="134"${mono(13)} fill="${t.muted}"><tspan fill="${t.accent}">jay.pokale.35@gmail.com</tspan>  ·  jaypokale.me</text>`];
  return svg(t, W, H, "Every problem here started unsolved. If yours is interesting enough, it won't stay that way. jay.pokale.35@gmail.com, jaypokale.me.", o);
}

// ── Data (GitHub API only) ───────────────────────────────────────────────────
async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': 'profile-art', Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, ...init.headers } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res;
}
// Every pull request matching the search, past the first page of 100.
async function prs(state) {
  const q = encodeURIComponent(`is:pr ${state} author:${LOGIN} -user:${LOGIN}`), items = [];
  for (let page = 1; page <= 10; page++) {
    const r = await (await api(`https://api.github.com/search/issues?per_page=100&page=${page}&q=${q}`)).json();
    items.push(...r.items);
    if (items.length >= r.total_count || r.items.length < 100) return { total: r.total_count, items };
  }
  throw new Error(`more than 1000 ${state} pull requests`);
}
async function load() {
  const q = 'query($l:String!){user(login:$l){avatarUrl(size:320) repository(name:"Chisle"){stargazerCount}}}';
  const g = await (await api('https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ query: q, variables: { l: LOGIN } }) })).json();
  if (g.errors) throw new Error(g.errors[0].message);
  const u = g.data.user;
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
    avatar, chisle: u.repository.stargazerCount, upstream: done.total, open: open.total, merged, review, otherRepos: other.size,
    featured: Object.values(merged).reduce((s, n) => s + n, 0),
  };
}

load().then((d) => {
  const out = path.resolve(process.argv[2] || 'out');
  fs.mkdirSync(out, { recursive: true });
  for (const [theme, t] of Object.entries(THEMES)) {
    for (const [name, build] of Object.entries({ hero, upstream, chisle, research, stack, closing })) fs.writeFileSync(path.join(out, `${name}-${theme}.svg`), build(t, d));
    LINKS.forEach(([id, label], i) => fs.writeFileSync(path.join(out, `link-${id}-${theme}.svg`), pill(t, label, i)));
  }
  console.log(`wrote ${out}: Chisle ${d.chisle} stars, ${d.featured} of ${d.upstream} merged PRs in featured orgs, ${d.open} open`);
}).catch((e) => { console.error(e.message); process.exit(1); });
