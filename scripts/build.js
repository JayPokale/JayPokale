#!/usr/bin/env node
// Draws the profile README's one image, dark and light: a bento of cards led
// by open-source impact, with only what GitHub doesn't already show beside the
// README (name, photo, bio, links, pinned repos and the contribution graph).
//
// Plain SVG + SMIL, so it animates inside GitHub's <img> sandbox. Each card
// eases in once and holds; nothing loops. Base attributes are the settled
// frame, so a renderer without SMIL shows that.
//
// Run: GITHUB_TOKEN=... node scripts/build.js <out-dir>
// .github/workflows/profile.yml runs it every 6 hours and publishes `output`.

'use strict';
const fs = require('fs');
const path = require('path');

const LOGIN = 'JayPokale';
// Upstream organisations to feature: GitHub owner -> display name. The first
// owner listed for a name supplies its logo.
const ORGS = { ClickHouse: 'ClickHouse', interledger: 'Interledger', lancedb: 'LanceDB', 'lance-format': 'LanceDB', 'ballerina-platform': 'Ballerina', temporalio: 'Temporal', pydantic: 'Pydantic', WICG: 'W3C WICG',
  nilbuild: 'roadmap.sh', avelino: 'awesome-go', VoltAgent: 'VoltAgent', davila7: 'Claude Code Templates', nesquena: 'Hermes WebUI', 'awesome-opencode': 'awesome-opencode' };
// Thesis lines as jaypokale.me states them; 63% -> 0% is attack success.
const RESEARCH = [
  ['Corroboration Is All You Can Certify', 'Poison a knowledge graph; I prove how much of the answer is still true.', ''],
  ['Cache Me If You Can', "Semantic caches can serve an attacker's answer to your question.", 'attack success 63% → 0%'],
  ['Some Memories Take Time', "Zipf's law fixes how many learning timescales a model needs: about nine.", ''],
];
const ELSEWHERE = [
  ['2,285', 'peak rating', 'Guardian', 'top 1%', 'amber', 0, 'LeetCode'],
  ['1,799', 'rating', 'Expert', '', 'blue', 0, 'Codeforces'],
  ['20k+', 'members', 'Founder', '', 'violet', 0, 'Dare2Solve'],
];
// Chisle's README race: same prompt, visible output tokens (Claude Code + Haiku 4.5).
const RACE = [['Chisle', 530], ['caveman', 604], ['ponytail', 747], ['no ruleset', 1186]];
const MERGED_ROWS = 4, REVIEW_ROWS = 2, RECENT_DAYS = 90, LOGO_MAX = 10, ORG_ROWS = 9;
// Both side-by-side cards share one height: the taller of the two lists.
const cardH = (d) => Math.max(56 + d.rows.length * 54, 54 + Math.min(d.byOrg.length, ORG_ROWS) * 39) + 4;

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Inter','Noto Sans',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const THEMES = {
  dark: { card: '#0f141b', edge: '#f0f6fc', edgeOp: 0.1, text: '#e6edf3', muted: '#8b949e', faint: '#6e7681', rule: '#21262d', track: '#1c2129', a1: '#f0a85a', a2: '#ff7b72', green: '#3fb950', red: '#f85149', amber: '#d29922', blue: '#58a6ff', violet: '#bc8cff', tint: 0.14, glow: 0.22, shadow: 0 },
  light: { card: '#ffffff', edge: '#1f2328', edgeOp: 0.13, text: '#1f2328', muted: '#59636e', faint: '#818b98', rule: '#eaeef2', track: '#eef1f4', a1: '#c2410c', a2: '#be123c', green: '#1a7f37', red: '#cf222e', amber: '#9a6700', blue: '#0969da', violet: '#8250df', tint: 0.1, glow: 0.1, shadow: 0.08 },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => n.toLocaleString('en-US');
const short = (n) => (n >= 1000 ? `${+(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);
// Rough proportional-font width, to truncate titles before they reach a pill.
const textW = (s, fs, bold = false) => [...s].reduce((w, c) => w + fs * (
  "ijl.,:;!|'`".includes(c) ? 0.27 : 'frt()-[]'.includes(c) ? 0.36 : c === ' ' ? 0.28 : /[mwMW@%]/.test(c) ? 0.84 : /[A-Z]/.test(c) ? 0.64 : /[0-9]/.test(c) ? 0.56 : 0.52), 0) * (bold ? 1.06 : 1);
const clip = (s, fs, max, bold) => {
  if (textW(s, fs, bold) <= max) return s;
  let t = s;
  while (t && textW(`${t}…`, fs, bold) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
};

// One SMIL timeline that plays once and holds: pts [[seconds, value], ...].
function anim(attr, pts, { ease = false, discrete = false, type } = {}) {
  const p = pts[0][0] > 0 ? [[0, pts[0][1]], ...pts] : pts;
  const dur = p[p.length - 1][0];
  const tag = type ? 'animateTransform' : 'animate';
  return `<${tag} attributeName="${attr}"${type ? ` type="${type}"` : ''} values="${p.map((x) => x[1]).join(';')}" keyTimes="${p.map((x) => (x[0] / dur).toFixed(4)).join(';')}" dur="${r2(dur)}s" fill="freeze"` +
    (discrete ? ' calcMode="discrete"' : ease ? ` calcMode="spline" keySplines="${Array(p.length - 1).fill('0.2 0.7 0.2 1').join(';')}"` : '') + '/>';
}
const fadeIn = (t0, f = 0.4) => anim('opacity', [[t0, 0], [r2(t0 + f), 1]], { ease: true });
// A group that fades and rises in at t0.
const appear = (t0, body, dy = 10, f = 0.55) =>
  `<g>${anim('opacity', [[t0, 0], [r2(t0 + f), 1]], { ease: true })}<g>${anim('transform', [[t0, `0 ${dy}`], [r2(t0 + f), '0 0']], { type: 'translate', ease: true })}${body}</g></g>`;
// A number that counts up once: stacked frames, each shown in turn.
function countUp(n, show, t0, attrs, frames = 14, dur = 0.9) {
  return Array.from({ length: frames + 1 }, (_, k) => {
    const v = Math.round(n * (1 - (1 - k / frames) ** 3)), tk = r2(t0 + (dur * k) / frames), tn = r2(t0 + (dur * (k + 1)) / frames);
    const pts = k === 0 ? [[0, 1], [tn, 0]] : k === frames ? [[0, 0], [tk, 1]] : [[0, 0], [tk, 1], [tn, 0]];
    return `<text ${attrs} opacity="${k === frames ? 1 : 0}">${anim('opacity', pts, { discrete: true })}${esc(show(v))}</text>`;
  }).join('');
}

const eyebrow = (t, x, y, s) => `<text x="${x}" y="${y}" font-size="11" font-weight="600" letter-spacing="1.6" fill="${t.muted}">${esc(s)}</text>`;
function pill(t, xEnd, cy, label, tone) {
  const w = r1(textW(label, 12, true) + 20), x = r1(xEnd - w);
  return `<rect x="${x}" y="${cy - 11}" width="${w}" height="22" rx="11" fill="${t[tone]}" fill-opacity="${t.tint}" stroke="${t[tone]}" stroke-opacity="0.35"/>` +
    `<text x="${r1(x + w / 2)}" y="${cy + 4}" font-size="12" font-weight="600" fill="${t[tone]}" text-anchor="middle">${esc(label)}</text>`;
}
const cardRect = (t, x, y, w, h) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="18" fill="${t.card}" stroke="${t.edge}" stroke-opacity="${t.edgeOp}"${t.shadow ? ' filter="url(#lift)"' : ''}/>`;
const logoId = (org) => `logo-${org.replace(/\W/g, '')}`;
const logo = (d, org, cx, cy, r) => (d.logos[org] ? `<use href="#${logoId(org)}" transform="translate(${r1(cx - r)} ${r1(cy - r)}) scale(${r2((2 * r) / 64)})"/>` : '');
const diff = (t, x, y, add, del, fs = 12) => `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${fs}"><tspan fill="${t.green}">+${fmt(add)}</tspan><tspan fill="${t.muted}"> </tspan><tspan fill="${t.red}">−${fmt(del)}</tspan></text>`;

// Shared defs: accent gradients, the round clip, and (when asked) the logos.
function doc(t, d, w, h, label, body, logos = false) {
  const defs = [
    `<radialGradient id="glowA" cx="0.92" cy="0" r="0.65"><stop offset="0" stop-color="${t.a1}" stop-opacity="${t.glow}"/><stop offset="1" stop-color="${t.a1}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="glowB" cx="0.55" cy="1.2" r="0.6"><stop offset="0" stop-color="${t.a2}" stop-opacity="${r2(t.glow * 0.7)}"/><stop offset="1" stop-color="${t.a2}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="ink" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stop-color="${t.a1}"/><stop offset="1" stop-color="${t.a2}"/></linearGradient>`,
    `<linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="${t.a1}"/><stop offset="1" stop-color="${t.a2}"/></linearGradient>`,
    `<clipPath id="round" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath>`,
  ];
  if (logos) defs.push(...Object.entries(d.logos).map(([org, uri]) => `<g id="${logoId(org)}"><circle cx="32" cy="32" r="32" fill="#fff"/><image href="${uri}" width="64" height="64" clip-path="url(#round)"/><circle cx="32" cy="32" r="31" fill="none" stroke="${t.edge}" stroke-opacity="${t.edgeOp}" stroke-width="2"/></g>`));
  if (t.shadow) defs.push(`<filter id="lift" x="-4%" y="-4%" width="108%" height="116%"><feDropShadow dx="0" dy="1" stdDeviation="1.6" flood-color="#1f2328" flood-opacity="${t.shadow}"/></filter>`);
  // A margin for the light theme's shadow.
  const m = t.shadow ? 3 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 2 * m}" height="${h + 2 * m}" viewBox="${-m} ${-m} ${w + 2 * m} ${h + 2 * m}" font-family="${SANS}" xml:space="preserve" role="img" aria-label="${esc(label)}">
<defs>${defs.join('')}</defs>
${cardRect(t, 0, 0, w, h)}
${body.join('\n')}
</svg>
`;
}
const glow = (w, h) => `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="17" fill="url(#glowA)"/><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="17" fill="url(#glowB)"/>`;
const strip = (t, stats, x0, w, y) => {
  const sw = w / stats.length, o = [];
  stats.forEach(([v, label, fill], i) => {
    const x = r1(x0 + i * sw);
    if (i) o.push(`<path d="M${r1(x - 14)} ${y - 16}V${y + 18}" stroke="${t.rule}"/>`);
    const value = v.startsWith('<text') ? v.replace('x="0" y="0"', `x="${x}" y="${y}"`) : `<text x="${x}" y="${y}" font-size="20" font-weight="700" fill="${fill || t.text}">${esc(v)}</text>`;
    o.push(appear(r2(0.55 + i * 0.06), value + `<text x="${x}" y="${y + 18}" font-size="12" fill="${t.muted}">${esc(label)}</text>`, 4));
  });
  return o.join('');
};

// ── Chisle: my own project, first.
function chisle(t, d) {
  const W = 880, H = 262, BX = 520, BW = W - 24 - (BX + 88) - 52;
  const max = Math.max(...RACE.map((r) => r[1]));
  const o = [glow(W, H), eyebrow(t, 24, 38, 'MY PROJECT'),
    `<text x="${W - 24}" y="38" font-size="12.5" fill="${t.muted}" text-anchor="end">github.com/JayPokale/Chisle ↗</text>`,
    `<text x="22" y="96" font-family="${MONO}" font-size="46" font-weight="700" letter-spacing="-1.5" fill="${t.text}">chisle</text>`,
    `<rect x="${r1(22 + 6 * 46 * 0.6 - 4)}" y="61" width="17" height="42" rx="2" fill="url(#ink)"/>`,
    `<text x="24" y="132" font-size="15.5" fill="${t.text}">Makes AI coding agents talk less, build less,</text>`,
    `<text x="24" y="154" font-size="15.5" fill="${t.text}">read less and say more.</text>`,
    `<text x="24" y="178" font-size="12.5" fill="${t.muted}">The only tool in its class that publishes the benchmarks it loses.</text>`,
    `<text x="${BX}" y="72" font-size="12" fill="${t.muted}">Same prompt · output tokens · lower is better</text>`];
  RACE.forEach(([name, n], i) => {
    const y = 90 + i * 24, w = r1((n / max) * BW), t0 = r2(0.4 + i * 0.08), me = i === 0;
    o.push(`<text x="${BX + 78}" y="${y + 10}" font-size="12.5" font-weight="${me ? 700 : 400}" fill="${me ? t.text : t.muted}" text-anchor="end">${esc(name)}</text>`,
      `<rect x="${BX + 88}" y="${y}" width="${w}" height="13" rx="4" fill="${me ? 'url(#bar)' : t.muted}" fill-opacity="${me ? 1 : 0.4}">${anim('width', [[t0, 0], [r2(t0 + 0.8), w]], { ease: true })}</rect>`,
      `<text x="${r1(BX + 88 + w + 8)}" y="${y + 10.5}" font-size="12" font-weight="${me ? 700 : 400}" fill="${me ? t.text : t.muted}">${fadeIn(r2(t0 + 0.7))}${fmt(n)}</text>`);
  });
  o.push(`<path d="M24 202H${W - 24}" stroke="${t.rule}"/>`,
    strip(t, [[fmt(d.chisle.stars), 'GitHub stars'], [fmt(d.chisle.downloads), 'npm downloads / month'], ['13', 'agents supported'],
      ['−45%', 'answer length', t.green], ['−48%', 'oversized tool output', t.green], ['156/156', 'answers still correct', t.green]], 24, W - 48, 232));
  return doc(t, d, W, H, `Chisle, my project: makes AI coding agents talk less, build less, read less and say more. ${fmt(d.chisle.stars)} GitHub stars, ${fmt(d.chisle.downloads)} npm downloads a month, 13 agents. Same prompt, output tokens: ` + RACE.map(([a, b]) => `${a} ${b}`).join(', ') + '. Answers 45% shorter, oversized tool output cut 48%, 156 of 156 answers still correct.', o);
}

// ── Open source: merged upstream, where, and how much.
function oss(t, d) {
  const W = 880, H = 236;
  const o = [glow(W, H), `<circle cx="32" cy="38" r="3.5" fill="${t.green}"/>`, eyebrow(t, 44, 42, 'OPEN SOURCE · LIVE FROM GITHUB'),
    `<text x="${W - 28}" y="42" font-size="12" fill="${t.faint}" text-anchor="end">Updated ${esc(d.stamp)}</text>`,
    countUp(d.merged, (v) => `${v}`, 0.25, `x="26" y="128" font-size="76" font-weight="750" letter-spacing="-3" fill="url(#ink)"`)];
  const nx = r1(26 + textW(`${d.merged}`, 76, true) * 0.92 + 18);
  o.push(appear(0.35, `<text x="${nx}" y="96" font-size="22" font-weight="650" letter-spacing="-0.4" fill="${t.text}">pull requests merged upstream</text>` +
    `<text x="${nx}" y="124" font-size="15" fill="${t.muted}">into projects with <tspan font-weight="700" fill="${t.text}">${short(d.stars)}</tspan> combined GitHub stars</text>`, 6));
  const orgs = d.byOrg.map(([n]) => n).slice(0, LOGO_MAX), R = 19, step = 30, sx = W - 28 - R - (orgs.length - 1) * step;
  o.push(...orgs.map((org, i) => appear(r2(0.45 + i * 0.06), `<circle cx="${sx + i * step}" cy="104" r="${R + 2.5}" fill="${t.card}"/>${logo(d, org, sx + i * step, 104, R)}`, 6, 0.4)),
    `<text x="${W - 28}" y="146" font-size="12" fill="${t.muted}" text-anchor="end">${esc(orgs.slice(0, 3).join(', '))}${d.byOrg.length > 3 ? ` and ${d.byOrg.length - 3} more` : ''}</text>`,
    `<path d="M26 172H${W - 26}" stroke="${t.rule}"/>`,
    strip(t, [[diff(t, 0, 0, d.add, d.del, 17), 'lines changed'], [`${d.repos}`, 'repositories'], [`${d.recent}`, `merged in the last ${RECENT_DAYS} days`], [`${d.open}`, 'in review right now']], 26, W - 52, 204));
  return doc(t, d, W, H, `Open source, live from GitHub: ${d.merged} pull requests merged upstream into projects with ${short(d.stars)} combined stars; +${d.add} and −${d.del} lines across ${d.repos} repositories; ${d.recent} merged in the last ${RECENT_DAYS} days; ${d.open} in review.`, o, true);
}

// ── Latest pull requests, with their size.
function prsCard(t, d) {
  const W = 548, H = cardH(d), o = [eyebrow(t, 24, 34, 'LATEST PULL REQUESTS'), `<text x="${W - 24}" y="34" font-size="12.5" fill="${t.muted}" text-anchor="end">all of them ↗</text>`];
  d.rows.forEach((p, i) => {
    const top = 56 + i * 54, cy = top + 22, status = p.merged ? ['Merged', 'green'] : ['In review', 'amber'];
    const pw = textW(status[0], 12, true) + 20, meta = `${p.repo} · ${p.date}`;
    const row = [logo(d, p.org, 37, cy, 13),
      `<text x="60" y="${cy - 3}" font-size="14" font-weight="500" fill="${t.text}">${esc(clip(p.title, 14, W - 24 - pw - 16 - 60, false))}</text>`,
      `<text x="60" y="${cy + 16}" font-size="12" fill="${t.muted}">${esc(meta)}</text>`,
      diff(t, r1(60 + textW(meta, 12) + 10), cy + 16, p.add, p.del, 11.5), pill(t, W - 24, cy, ...status)];
    if (i < d.rows.length - 1) row.push(`<path d="M24 ${top + 50}H${W - 24}" stroke="${t.rule}"/>`);
    o.push(appear(r2(0.3 + i * 0.07), row.join(''), 6));
  });
  return doc(t, d, W, H, 'Latest pull requests: ' + d.rows.map((p) => `${p.repo}, "${p.title}", +${p.add} −${p.del}, ${p.merged ? 'merged' : 'in review'} ${p.date}`).join('; ') + '.', o, true);
}

// ── By project: merged count, against each project's size.
function orgsCard(t, d) {
  const W = 320, H = cardH(d), o = [eyebrow(t, 24, 34, 'MERGED INTO')];
  const max = Math.max(...d.byOrg.map((r) => r[1])), BW = W - 48;
  d.byOrg.slice(0, ORG_ROWS).forEach(([org, n, stars], j) => {
    const top = 54 + j * 39, w = r1(Math.max(5, (n / max) * (BW - 40))), t0 = r2(0.35 + j * 0.06);
    o.push(logo(d, org, 34, top + 10, 10),
      `<text x="52" y="${top + 14.5}" font-size="13.5" font-weight="600" fill="${t.text}">${esc(org)}</text>`,
      `<text x="${r1(52 + textW(org, 13.5, true) + 8)}" y="${top + 14.5}" font-size="12" fill="${t.faint}">★ ${short(stars)}</text>`,
      `<text x="${W - 24}" y="${top + 14.5}" font-size="13.5" font-weight="700" fill="${t.text}" text-anchor="end">${n}</text>`,
      `<rect x="24" y="${top + 23}" width="${BW}" height="5" rx="2.5" fill="${t.track}"/>`,
      `<rect x="24" y="${top + 23}" width="${w}" height="5" rx="2.5" fill="url(#bar)">${anim('width', [[t0, 0], [r2(t0 + 0.7), w]], { ease: true })}</rect>`);
  });
  return doc(t, d, W, H, 'Merged into: ' + d.byOrg.map(([n, k, s]) => `${n} ${k} (${short(s)} stars)`).join(', ') + '.', o, true);
}

// ── Research.
function research(t, d) {
  const W = 880, H = 196, o = [eyebrow(t, 24, 34, 'RESEARCH'), `<text x="${W - 24}" y="34" font-size="12.5" fill="${t.muted}" text-anchor="end">three theses in progress · jaypokale.me ↗</text>`];
  RESEARCH.forEach(([title, line, chip], k) => {
    const ty = 66 + k * 46;
    o.push(appear(r2(0.2 + k * 0.08), `<text x="24" y="${ty}" font-size="15" font-weight="650" fill="${t.text}">${esc(title)}</text>` +
      `<text x="24" y="${ty + 19}" font-size="13" fill="${t.muted}">${esc(line)}</text>` + (chip ? pill(t, W - 24, ty + 3, chip, 'green') : ''), 5));
  });
  return doc(t, d, W, H, 'Research, three theses in progress: ' + RESEARCH.map(([a, b]) => `${a}: ${b}`).join(' '), o);
}

// ── One rating or community tile.
function tile(t, d, [n, label, badge, note, tone, , site]) {
  const W = 288, H = 112;
  const o = [eyebrow(t, 22, 32, site.toUpperCase()), `<text x="${W - 22}" y="32" font-size="12" fill="${t.muted}" text-anchor="end">↗</text>`,
    appear(0.3, `<text x="22" y="76" font-size="28" font-weight="750" letter-spacing="-0.6" fill="${t.text}">${esc(n)}</text>` +
      `<text x="22" y="97" font-size="12.5" fill="${t.muted}">${esc(label)} · <tspan font-weight="600" fill="${t[tone]}">${esc(badge)}</tspan>${note ? ` · ${esc(note)}` : ''}</text>`, 5)];
  return doc(t, d, W, H, `${site}: ${label} ${n}, ${badge}${note ? `, ${note}` : ''}.`, o);
}

// ── Follow buttons: one small clickable image each, with its icon.
const ICONS = {
  github: (c) => `<path transform="translate(0 0) scale(1.125)" fill="${c}" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>`,
  linkedin: () => `<rect width="18" height="18" rx="3.5" fill="#0a66c2"/><text x="9" y="13.6" font-size="11.5" font-weight="800" fill="#fff" text-anchor="middle">in</text>`,
  x: (c) => `<rect width="18" height="18" rx="3.5" fill="${c}"/><path d="M5 4.5l8 9M13 4.5l-8 9" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`,
  site: (c) => `<circle cx="9" cy="9" r="7.6" fill="none" stroke="${c}" stroke-width="1.5"/><ellipse cx="9" cy="9" rx="3.4" ry="7.6" fill="none" stroke="${c}" stroke-width="1.3"/><path d="M1.6 9h14.8M3 5h12M3 13h12" stroke="${c}" stroke-width="1.2"/>`,
  devto: (c) => `<rect width="18" height="18" rx="3.5" fill="${c}"/><text x="9" y="12.4" font-size="7" font-weight="800" fill="#fff" text-anchor="middle" letter-spacing="0.2">DEV</text>`,
  email: (c) => `<rect x="1" y="3.5" width="16" height="11" rx="2.2" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M1.8 4.6L9 10l7.2-5.4" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>`,
};
function follow(t, d, [id, label, count]) {
  const lw = textW(label, 13.5, true), cw = count ? textW(count, 12, true) + 18 : 0;
  const W = r1(14 + 18 + 10 + lw + (count ? 10 + cw : 0) + 16), H = 40, ink = t.text === '#1f2328' ? '#1f2328' : '#e6edf3';
  const o = [`<g transform="translate(14 11)">${ICONS[id](id === 'x' || id === 'devto' ? (ink === '#e6edf3' ? '#000' : '#1f2328') : ink)}</g>`,
    `<text x="42" y="25" font-size="13.5" font-weight="600" fill="${t.text}">${esc(label)}</text>`];
  if (count) o.push(`<rect x="${r1(W - 16 - cw)}" y="10" width="${r1(cw)}" height="20" rx="10" fill="${t.track}"/><text x="${r1(W - 16 - cw / 2)}" y="24" font-size="12" font-weight="600" fill="${t.muted}" text-anchor="middle">${esc(count)}</text>`);
  return doc(t, d, W, H, `${label}${count ? ` (${count})` : ''}`, o).replace('rx="18"', 'rx="20"');
}

// ── Data (GitHub API only) ───────────────────────────────────────────────────
async function api(url, raw = false) {
  const res = await fetch(url, { headers: { 'User-Agent': 'profile-art', Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return raw ? res : res.json();
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
// Runs fn over items, a few at a time.
async function pool(items, fn, n = 8) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}
// `fix(SplitButton): make…` reads better as `SplitButton: make…`.
const tidy = (s) => {
  const m = s.match(/^(?:fix|feat|perf|refactor|chore|test|build|ci)(?:\(([^)]*)\))?!?:\s*(.*)$/i);
  const t = (m ? (m[1] ? `${m[1]}: ${m[2]}` : m[2]) : s).trim();
  return t[0].toUpperCase() + t.slice(1);
};
const day = (dt) => `${dt.getUTCDate()} ${dt.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`;

async function load() {
  const [done, open] = await Promise.all([prs('is:merged'), prs('is:open')]);
  const featured = (items, merged) => items.map((it) => {
    const [owner, repo] = it.repository_url.split('/repos/')[1].split('/');
    return { org: ORGS[owner], repo: `${owner}/${repo}`, api: it.pull_request.url, merged, when: new Date(merged ? it.pull_request.merged_at || it.closed_at : it.created_at), title: tidy(it.title) };
  }).filter((p) => p.org);
  const m = featured(done, true), r = featured(open, false);
  // Size of every featured pull request, for the totals and the list.
  await pool([...m, ...r], async (p) => { const x = await api(p.api); p.add = x.additions; p.del = x.deletions; });
  const repos = [...new Set(m.map((p) => p.repo))];
  const stars = Object.fromEntries(await pool(repos, async (k) => [k, (await api(`https://api.github.com/repos/${k}`)).stargazers_count]));
  const by = {};
  for (const p of m) {
    const e = (by[p.org] ||= [p.org, 0, 0]);
    e[1] += 1;
    e[2] = Math.max(e[2], stars[p.repo]);
  }
  const byOrg = Object.values(by).sort((a, b) => b[1] - a[1] || b[2] - a[2]);
  // The list shows recent code changes; docs-only fixes still count in the totals.
  const recent = (list, n) => list.filter((p) => !/^docs?\b/i.test(p.title)).sort((a, b) => b.when - a.when).slice(0, n);
  const rows = [...recent(m, MERGED_ROWS), ...recent(r, REVIEW_ROWS)].sort((a, b) => b.when - a.when).map((p) => ({ ...p, date: day(p.when) }));
  // Logos: each organisation's GitHub avatar, embedded so the image stands alone.
  const logos = {};
  await pool(byOrg.map(([n]) => n), async (name) => {
    const owner = Object.keys(ORGS).find((k) => ORGS[k] === name);
    const u = await api(`https://api.github.com/users/${owner}`);
    const img = await api(`${u.avatar_url}${u.avatar_url.includes('?') ? '&' : '?'}s=64`, true);
    logos[name] = `data:${img.headers.get('content-type') || 'image/png'};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
  });
  const repo = await api(`https://api.github.com/repos/${LOGIN}/Chisle`), me = await api(`https://api.github.com/users/${LOGIN}`);
  const npm = await (await fetch('https://api.npmjs.org/downloads/point/last-month/chisle')).json();
  const now = new Date(), since = now - RECENT_DAYS * 864e5;
  return {
    rows, byOrg, logos, merged: m.length, open: r.length, repos: repos.length,
    stars: Object.values(stars).reduce((s, n) => s + n, 0),
    add: m.reduce((s, p) => s + p.add, 0), del: m.reduce((s, p) => s + p.del, 0),
    recent: m.filter((p) => p.when >= since).length,
    followers: me.followers,
    chisle: { stars: repo.stargazers_count, downloads: npm.downloads || 0 },
    stamp: `${day(now)} ${now.getUTCFullYear()}, ${now.toISOString().slice(11, 16)} UTC`,
  };
}

load().then((d) => {
  const out = path.resolve(process.argv[2] || 'out');
  fs.mkdirSync(out, { recursive: true });
  const FOLLOW = [['github', 'Follow', `${fmt(d.followers)}`], ['linkedin', 'LinkedIn'], ['x', 'X'], ['site', 'jaypokale.me'], ['devto', 'dev.to'], ['email', 'Email']];
  for (const [theme, t] of Object.entries(THEMES)) {
    const panels = { chisle, oss, prs: prsCard, orgs: orgsCard, research };
    for (const [name, build] of Object.entries(panels)) fs.writeFileSync(path.join(out, `${name}-${theme}.svg`), build(t, d));
    for (const e of ELSEWHERE) fs.writeFileSync(path.join(out, `${e[6].toLowerCase()}-${theme}.svg`), tile(t, d, e));
    for (const f of FOLLOW) fs.writeFileSync(path.join(out, `follow-${f[0]}-${theme}.svg`), follow(t, d, f));
  }
  console.log(`wrote ${out} · ${d.merged} merged, ${d.open} in review, Chisle ${d.chisle.stars} stars, ${d.followers} followers`);
}).catch((e) => { console.error(e.message); process.exit(1); });
