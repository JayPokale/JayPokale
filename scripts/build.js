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
const ORGS = { ClickHouse: 'ClickHouse', interledger: 'Interledger', lancedb: 'LanceDB', 'lance-format': 'LanceDB', 'ballerina-platform': 'Ballerina', temporalio: 'Temporal', pydantic: 'Pydantic', WICG: 'W3C WICG' };
// Thesis lines as jaypokale.me states them; 63% -> 0% is attack success.
const RESEARCH = [
  ['Corroboration Is All You Can Certify', 'Poison a knowledge graph; I prove how much of the answer is still true.', ''],
  ['Cache Me If You Can', "Semantic caches can serve an attacker's answer to your question.", 'attack success 63% → 0%'],
  ['Some Memories Take Time', "Zipf's law fixes how many learning timescales a model needs: about nine.", ''],
];
const ELSEWHERE = [
  ['2,285', 'LeetCode peak rating', 'Guardian', 'top 1%', 'amber'],
  ['1,799', 'Codeforces rating', 'Expert', '', 'blue'],
  ['20k+', 'Dare2Solve members', 'Founder', '', 'violet'],
];
const MERGED_ROWS = 3, REVIEW_ROWS = 2, RECENT_DAYS = 90;

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

function bento(t, d) {
  const W = 880, G = 12, LW = 548, RX = LW + G, RW = W - RX;
  const H1 = 236, Y2 = H1 + G, H2 = 330, Y3 = Y2 + H2 + G, H3 = 196, H = Y3 + H3;
  const o = [];
  const defs = [
    `<radialGradient id="glowA" cx="0.92" cy="0" r="0.65"><stop offset="0" stop-color="${t.a1}" stop-opacity="${t.glow}"/><stop offset="1" stop-color="${t.a1}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="glowB" cx="0.55" cy="1.2" r="0.6"><stop offset="0" stop-color="${t.a2}" stop-opacity="${r2(t.glow * 0.7)}"/><stop offset="1" stop-color="${t.a2}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="ink" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stop-color="${t.a1}"/><stop offset="1" stop-color="${t.a2}"/></linearGradient>`,
    `<linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="${t.a1}"/><stop offset="1" stop-color="${t.a2}"/></linearGradient>`,
    `<clipPath id="round" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath>`,
    ...Object.entries(d.logos).map(([org, uri]) => `<g id="${logoId(org)}"><circle cx="32" cy="32" r="32" fill="#fff"/><image href="${uri}" width="64" height="64" clip-path="url(#round)"/><circle cx="32" cy="32" r="31" fill="none" stroke="${t.edge}" stroke-opacity="${t.edgeOp}" stroke-width="2"/></g>`),
  ];
  if (t.shadow) defs.push(`<filter id="lift" x="-4%" y="-4%" width="108%" height="116%"><feDropShadow dx="0" dy="1" stdDeviation="1.6" flood-color="#1f2328" flood-opacity="${t.shadow}"/></filter>`);

  // ── Impact: merged upstream, where, and how much.
  {
    const c = [cardRect(t, 0, 0, W, H1),
      `<rect x="1" y="1" width="${W - 2}" height="${H1 - 2}" rx="17" fill="url(#glowA)"/><rect x="1" y="1" width="${W - 2}" height="${H1 - 2}" rx="17" fill="url(#glowB)"/>`,
      `<circle cx="32" cy="38" r="3.5" fill="${t.green}"/>`, eyebrow(t, 44, 42, 'OPEN SOURCE · LIVE FROM GITHUB'),
      `<text x="${W - 28}" y="42" font-size="12" fill="${t.faint}" text-anchor="end">Updated ${esc(d.stamp)}</text>`,
      countUp(d.merged, (v) => `${v}`, 0.25, `x="26" y="128" font-size="76" font-weight="750" letter-spacing="-3" fill="url(#ink)"`)];
    const nx = r1(26 + textW(`${d.merged}`, 76, true) * 0.92 + 18);
    c.push(appear(0.35, `<text x="${nx}" y="96" font-size="22" font-weight="650" letter-spacing="-0.4" fill="${t.text}">pull requests merged upstream</text>` +
      `<text x="${nx}" y="124" font-size="15" fill="${t.muted}">into projects with <tspan font-weight="700" fill="${t.text}">${short(d.stars)}</tspan> combined GitHub stars</text>`, 6));
    // The organisations, as an overlapping logo stack.
    const orgs = d.byOrg.map(([n]) => n), R = 19, step = 30, sx = W - 28 - R - (orgs.length - 1) * step;
    c.push(...orgs.map((org, i) => appear(r2(0.45 + i * 0.06),
      `<circle cx="${sx + i * step}" cy="104" r="${R + 2.5}" fill="${t.card}"/>${logo(d, org, sx + i * step, 104, R)}`, 6, 0.4)));
    c.push(`<text x="${W - 28}" y="146" font-size="12" fill="${t.muted}" text-anchor="end">${esc(orgs.slice(0, 3).join(', '))}${orgs.length > 3 ? ` and ${orgs.length - 3} more` : ''}</text>`);
    // Stat strip.
    const stats = [
      [diff(t, 0, 0, d.add, d.del, 17), 'lines changed'],
      [`${d.repos}`, 'repositories'],
      [`${d.recent}`, `merged in the last ${RECENT_DAYS} days`],
      [`${d.open}`, 'in review right now'],
    ];
    const sw = (W - 52) / stats.length;
    c.push(`<path d="M26 172H${W - 26}" stroke="${t.rule}"/>`);
    stats.forEach(([v, label], i) => {
      const x = r1(26 + i * sw);
      const value = v.startsWith('<text') ? v.replace('x="0" y="0"', `x="${x}" y="204"`) : `<text x="${x}" y="204" font-size="20" font-weight="700" fill="${t.text}">${esc(v)}</text>`;
      c.push(appear(r2(0.6 + i * 0.07), value + `<text x="${x}" y="222" font-size="12" fill="${t.muted}">${esc(label)}</text>`, 4));
      if (i) c.push(`<path d="M${r1(x - 14)} 186V222" stroke="${t.rule}"/>`);
    });
    o.push(appear(0.05, c.join(''), 6));
  }

  // ── Latest pull requests, with their size.
  {
    const y = Y2, c = [cardRect(t, 0, y, LW, H2), eyebrow(t, 24, y + 34, 'LATEST PULL REQUESTS'),
      `<text x="${LW - 24}" y="${y + 34}" font-size="12.5" fill="${t.muted}" text-anchor="end">all of them on GitHub ↗</text>`];
    d.rows.forEach((p, i) => {
      const top = y + 56 + i * 54, cy = top + 22, status = p.merged ? ['Merged', 'green'] : ['In review', 'amber'];
      const pw = textW(status[0], 12, true) + 20;
      const meta = `${p.repo} · ${p.date}`, mw = textW(meta, 12);
      const row = [logo(d, p.org, 37, cy, 13),
        `<text x="60" y="${cy - 3}" font-size="14" font-weight="500" fill="${t.text}">${esc(clip(p.title, 14, LW - 24 - pw - 16 - 60, false))}</text>`,
        `<text x="60" y="${cy + 16}" font-size="12" fill="${t.muted}">${esc(meta)}</text>`,
        diff(t, r1(60 + mw + 10), cy + 16, p.add, p.del, 11.5),
        pill(t, LW - 24, cy, ...status)];
      if (i < d.rows.length - 1) row.push(`<path d="M24 ${top + 50}H${LW - 24}" stroke="${t.rule}"/>`);
      c.push(appear(r2(0.5 + i * 0.07), row.join(''), 6));
    });
    o.push(appear(0.2, c.join('')));
  }

  // ── By project: merged count, against each project's size.
  {
    const x = RX, y = Y2, c = [cardRect(t, x, y, RW, H2), eyebrow(t, x + 24, y + 34, 'MERGED INTO')];
    const max = Math.max(...d.byOrg.map((r) => r[1])), BX = x + 24, BW = RW - 48;
    d.byOrg.forEach(([org, n, stars], j) => {
      const top = y + 54 + j * 39, w = r1(Math.max(5, (n / max) * (BW - 40))), t0 = r2(0.55 + j * 0.06);
      c.push(logo(d, org, x + 34, top + 10, 10),
        `<text x="${x + 52}" y="${top + 14.5}" font-size="13.5" font-weight="600" fill="${t.text}">${esc(org)}</text>`,
        `<text x="${r1(x + 52 + textW(org, 13.5, true) + 8)}" y="${top + 14.5}" font-size="12" fill="${t.faint}">★ ${short(stars)}</text>`,
        `<text x="${x + RW - 24}" y="${top + 14.5}" font-size="13.5" font-weight="700" fill="${t.text}" text-anchor="end">${n}</text>`,
        `<rect x="${BX}" y="${top + 23}" width="${BW}" height="5" rx="2.5" fill="${t.track}"/>`,
        `<rect x="${BX}" y="${top + 23}" width="${w}" height="5" rx="2.5" fill="url(#bar)">${anim('width', [[t0, 0], [r2(t0 + 0.7), w]], { ease: true })}</rect>`);
    });
    o.push(appear(0.28, c.join('')));
  }

  // ── Research.
  {
    const y = Y3, c = [cardRect(t, 0, y, LW, H3), eyebrow(t, 24, y + 34, 'RESEARCH'),
      `<text x="${LW - 24}" y="${y + 34}" font-size="12.5" fill="${t.muted}" text-anchor="end">three theses in progress</text>`];
    RESEARCH.forEach(([title, line, chip], k) => {
      const ty = y + 66 + k * 46;
      c.push(`<text x="24" y="${ty}" font-size="14.5" font-weight="650" fill="${t.text}">${esc(title)}</text>`,
        `<text x="24" y="${ty + 19}" font-size="12.5" fill="${t.muted}">${esc(line)}</text>`);
      if (chip) c.push(pill(t, LW - 24, ty - 5, chip, 'green'));
    });
    o.push(appear(0.36, c.join('')));
  }

  // ── Ratings and community.
  {
    const x = RX, y = Y3, c = [cardRect(t, x, y, RW, H3), eyebrow(t, x + 24, y + 34, 'RATINGS · COMMUNITY')];
    ELSEWHERE.forEach(([n, label, badge, note, tone], m) => {
      const by = y + 76 + m * 44;
      c.push(appear(r2(0.6 + m * 0.08),
        `<text x="${x + 24}" y="${by + 4}" font-size="22" font-weight="700" letter-spacing="-0.4" fill="${t.text}">${esc(n)}</text>` +
        `<text x="${x + 104}" y="${by - 4}" font-size="13" fill="${t.text}">${esc(label)}</text>` +
        `<text x="${x + 104}" y="${by + 13}" font-size="12" fill="${t.muted}"><tspan font-weight="600" fill="${t[tone]}">${esc(badge)}</tspan>${note ? ` · ${esc(note)}` : ''}</text>`, 4));
    });
    o.push(appear(0.44, c.join('')));
  }

  const label = `Open source, live from GitHub: ${d.merged} pull requests merged upstream into projects with ${short(d.stars)} combined stars (` +
    d.byOrg.map(([n, k]) => `${n} ${k}`).join(', ') + `); +${d.add} and −${d.del} lines across ${d.repos} repositories; ${d.recent} merged in the last ${RECENT_DAYS} days; ${d.open} in review. Latest: ` +
    d.rows.map((p) => `${p.repo}, "${p.title}", ${p.merged ? 'merged' : 'in review'} ${p.date}`).join('; ') +
    '. Research: ' + RESEARCH.map(([a, b]) => `${a}: ${b}`).join(' ') + ' ' + ELSEWHERE.map(([n, l, b, x]) => `${l} ${n}, ${b}${x ? `, ${x}` : ''}`).join('; ') + '.';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}" xml:space="preserve" role="img" aria-label="${esc(label)}">
<defs>${defs.join('')}</defs>
${o.join('\n')}
</svg>
`;
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
  const now = new Date(), since = now - RECENT_DAYS * 864e5;
  return {
    rows, byOrg, logos, merged: m.length, open: r.length, repos: repos.length,
    stars: Object.values(stars).reduce((s, n) => s + n, 0),
    add: m.reduce((s, p) => s + p.add, 0), del: m.reduce((s, p) => s + p.del, 0),
    recent: m.filter((p) => p.when >= since).length,
    stamp: `${day(now)} ${now.getUTCFullYear()}, ${now.toISOString().slice(11, 16)} UTC`,
  };
}

load().then((d) => {
  const out = path.resolve(process.argv[2] || 'out');
  fs.mkdirSync(out, { recursive: true });
  for (const [theme, t] of Object.entries(THEMES)) fs.writeFileSync(path.join(out, `bento-${theme}.svg`), bento(t, d));
  console.log(`wrote ${out}: bento (dark, light) · ${d.merged} merged into ${d.repos} repos (${d.stars} stars), +${d.add} −${d.del}, ${d.recent} in ${RECENT_DAYS} days, ${d.open} in review`);
}).catch((e) => { console.error(e.message); process.exit(1); });
