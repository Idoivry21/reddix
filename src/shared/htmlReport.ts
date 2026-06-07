import { PROVIDER_META } from './providers';
import type { SocialItem } from './types';
import { coerceFiniteNumber } from './values';

export interface HtmlReportMeta {
  /** Flow name shown in the report header. */
  flowName: string;
  /** ISO timestamp the report was generated; caller supplies (engine run time). */
  generatedAt: string;
}

/**
 * Escape the five HTML-significant characters. Applied to EVERY interpolated
 * text value, because the report embeds attacker-influenceable fetched content
 * (titles, bodies, authors, communities, URLs). Ampersand is replaced first so
 * the entities introduced by the later replacements are not double-encoded.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Return `url` only when it parses as an `http:`/`https:` URL; otherwise null.
 * Blocks `javascript:`, `data:`, `vbscript:`, `mailto:`, and malformed values so
 * a stored URL cannot become an XSS or phishing vector when rendered as a link
 * or image source. The result is still attribute-escaped at the call site.
 */
export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;
const PLATFORM_LABEL: Record<SocialItem['platform'], string> = {
  reddit: PROVIDER_META.reddit.badge,
  twitter: PROVIDER_META.twitter.badge
};

/**
 * Serialize normalized items into ONE self-contained HTML document: inline
 * styles + inline vanilla JS, no external assets, so it opens from `file://`.
 * All untrusted content is escaped once here at generation time; the embedded
 * script only filters/sorts the already-rendered DOM (it never templates), so
 * no escaping happens client-side.
 */
export function serializeHtml(items: SocialItem[], meta: HtmlReportMeta): string {
  const total = items.length;
  const redditCount = items.filter((item) => item.platform === 'reddit').length;
  const twitterCount = items.filter((item) => item.platform === 'twitter').length;
  const flowName = escapeHtml(meta.flowName);
  const generated = escapeHtml(parseDate(meta.generatedAt).display);

  const cards = items.map(renderCard).join('\n');
  const emptyState = total === 0 ? '<div class="empty" id="empty">No items in this report.</div>' : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${flowName} — Reddix Report</title>
<style>${STYLES}</style>
</head>
<body>
<header class="report-head" data-total="${total}" data-reddit="${redditCount}" data-twitter="${twitterCount}">
  <div class="head-top">
    <h1>${flowName}</h1>
    <span class="generated">Generated ${generated}</span>
  </div>
  <div class="stats">
    <span class="stat stat-total"><b>${total}</b> ${total === 1 ? 'result' : 'results'}</span>
    <span class="stat stat-reddit"><b>${redditCount}</b> reddit</span>
    <span class="stat stat-x"><b>${twitterCount}</b> x</span>
  </div>
  <div class="controls">
    <input id="q" class="search" type="search" placeholder="Search results…" aria-label="Search results" />
    <label class="ctl">Platform
      <select id="platform" aria-label="Filter by platform">
        <option value="all">All</option>
        <option value="reddit">Reddit</option>
        <option value="twitter">X</option>
      </select>
    </label>
    <label class="ctl">Sort
      <select id="sort" aria-label="Sort results">
        <option value="date">Newest</option>
        <option value="score">Top score</option>
      </select>
    </label>
  </div>
</header>
<main id="grid" class="grid">
${cards}
</main>
${emptyState}
<div class="empty" id="noMatch" hidden>No results match your filters.</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

function renderCard(item: SocialItem): string {
  const { display: dateDisplay, epoch } = parseDate(item.createdAt);
  const badge = PLATFORM_LABEL[item.platform];
  const handle = escapeHtml(originLabel(item));
  const title = item.platform === 'reddit' ? item.title : null;
  const bodyText = item.platform === 'reddit' ? item.body : item.text;
  const score = coerceNumber(item.engagement.score);

  const titleHtml = title ? `<h2 class="card-title">${escapeHtml(title)}</h2>` : '';
  const bodyHtml = bodyText ? `<p class="card-body">${escapeHtml(bodyText)}</p>` : '';
  const href = safeHref(item.url);
  const linkHtml = href
    ? `<a class="card-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">open original ↗</a>`
    : '';

  return `<article class="card platform-${item.platform}" data-platform="${item.platform}" data-score="${score ?? 0}" data-date="${epoch}">
  <div class="card-head">
    <span class="badge badge-${item.platform}">${badge}</span>
    <span class="handle">${handle}</span>
    <time class="card-date">${escapeHtml(dateDisplay)}</time>
  </div>
  ${imageThumb(item.media)}
  ${titleHtml}
  ${bodyHtml}
  <div class="card-foot">
    <span class="engagement">${renderEngagement(item)}</span>
    ${linkHtml}
  </div>
</article>`;
}

function originLabel(item: SocialItem): string {
  if (item.platform === 'reddit') {
    if (item.community) {
      return `r/${item.community}`;
    }
    return item.author ? `u/${item.author}` : 'reddit';
  }
  return item.author ? `@${item.author}` : 'x';
}

function renderEngagement(item: SocialItem): string {
  const parts: string[] = [];
  if (item.platform === 'reddit') {
    pushMetric(parts, '↑', item.engagement.score, 'score');
    pushMetric(parts, '💬', item.engagement.comments, 'comments');
  } else {
    pushMetric(parts, '♥', item.engagement.likes, 'likes');
    pushMetric(parts, '🔁', item.engagement.retweets, 'retweets');
    pushMetric(parts, '👁', item.engagement.views, 'views');
  }
  return parts.join('');
}

function pushMetric(parts: string[], icon: string, raw: unknown, label: string): void {
  const value = coerceNumber(raw);
  if (value === null) {
    return;
  }
  parts.push(`<span class="metric" title="${label}">${icon} ${escapeHtml(formatCount(value))}</span>`);
}

function imageThumb(media: SocialItem['media']): string {
  const first = media[0];
  if (!first) {
    return '';
  }
  const href = safeHref(first.url);
  if (!href) {
    return '';
  }
  const isImage = first.type === 'image' || IMAGE_EXTENSION.test(href);
  if (!isImage) {
    return '';
  }
  return `<img class="card-media" loading="lazy" alt="" src="${escapeHtml(href)}" />`;
}

const coerceNumber = coerceFiniteNumber;

function formatCount(value: number): string {
  // Thresholds are nudged below each round boundary (999_950, not 1_000_000) so a
  // value like 999_999 rolls over to "1.0M" instead of rounding to a nonsensical
  // "1000.0k" inside the lower unit's branch.
  const abs = Math.abs(value);
  if (abs >= 999_950_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 999_950) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

function parseDate(iso: string): { display: string; epoch: number } {
  const date = new Date(iso);
  const epoch = date.getTime();
  if (Number.isNaN(epoch)) {
    return { display: iso, epoch: 0 };
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  const display = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())} UTC`;
  return { display, epoch };
}

const STYLES = `
:root{--bg:#0b0d12;--panel:#141821;--panel-2:#1b212d;--line:#252c3a;--text:#e6e9f0;--muted:#8a93a6;--reddit:#ff4500;--x:#1d9bf0;--accent:#7c9cff}
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;background:radial-gradient(1200px 600px at 80% -10%,#19202e 0,var(--bg) 60%);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.report-head{position:sticky;top:0;z-index:5;padding:20px 24px 16px;background:rgba(11,13,18,.82);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.head-top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
.report-head h1{margin:0;font-size:20px;font-weight:650;letter-spacing:-.01em}
.generated{color:var(--muted);font-size:12.5px}
.stats{display:flex;gap:16px;margin:10px 0 14px;color:var(--muted);font-size:13px}
.stat b{color:var(--text);font-weight:650}
.stat-reddit b{color:var(--reddit)}
.stat-x b{color:var(--x)}
.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.search{flex:1 1 220px;min-width:160px;background:var(--panel);border:1px solid var(--line);color:var(--text);padding:9px 12px;border-radius:10px;font-size:14px;outline:none}
.search:focus{border-color:var(--accent)}
.ctl{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12.5px}
.ctl select{background:var(--panel);border:1px solid var(--line);color:var(--text);padding:8px 10px;border-radius:10px;font-size:13px;outline:none}
.ctl select:focus{border-color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;padding:20px 24px;max-width:1400px;margin:0 auto}
.card{background:linear-gradient(180deg,var(--panel) 0,var(--panel-2) 100%);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;overflow:hidden;transition:border-color .15s,transform .15s}
.card:hover{border-color:#33405a;transform:translateY(-1px)}
.platform-reddit{border-left:3px solid var(--reddit)}
.platform-twitter{border-left:3px solid var(--x)}
.card-head{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted)}
.badge{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:999px;color:#fff}
.badge-reddit{background:var(--reddit)}
.badge-twitter{background:var(--x)}
.handle{color:var(--text);font-weight:550}
.card-date{margin-left:auto;color:var(--muted);font-size:11.5px}
.card-media{width:100%;max-height:200px;object-fit:cover;border-radius:10px;border:1px solid var(--line)}
.card-title{margin:2px 0 0;font-size:15.5px;font-weight:620;line-height:1.35}
.card-body{margin:0;color:#c4cbdb;font-size:13.5px;white-space:pre-wrap;word-break:break-word}
.card-foot{margin-top:auto;padding-top:6px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.engagement{display:flex;gap:12px;color:var(--muted);font-size:12.5px}
.metric{white-space:nowrap}
.card-link{color:var(--accent);text-decoration:none;font-size:12.5px;font-weight:550}
.card-link:hover{text-decoration:underline}
.empty{text-align:center;color:var(--muted);padding:60px 20px;font-size:15px}
@media (max-width:560px){.grid{grid-template-columns:1fr;padding:16px}.report-head{padding:16px}}
`;

const SCRIPT = `
(function(){
  var grid=document.getElementById('grid');
  if(!grid)return;
  var search=document.getElementById('q');
  var sortSel=document.getElementById('sort');
  var platSel=document.getElementById('platform');
  var noMatch=document.getElementById('noMatch');
  var cards=Array.prototype.slice.call(grid.querySelectorAll('.card'));
  function apply(){
    var q=(search.value||'').trim().toLowerCase();
    var plat=platSel.value;
    var sort=sortSel.value;
    var visible=[];
    cards.forEach(function(card){
      var okPlat=plat==='all'||card.getAttribute('data-platform')===plat;
      var okText=!q||card.textContent.toLowerCase().indexOf(q)!==-1;
      var show=okPlat&&okText;
      card.style.display=show?'':'none';
      if(show)visible.push(card);
    });
    visible.sort(function(a,b){
      if(sort==='score')return Number(b.getAttribute('data-score'))-Number(a.getAttribute('data-score'));
      return Number(b.getAttribute('data-date'))-Number(a.getAttribute('data-date'));
    });
    visible.forEach(function(card){grid.appendChild(card);});
    if(noMatch)noMatch.hidden=cards.length===0||visible.length>0;
  }
  search.addEventListener('input',apply);
  sortSel.addEventListener('change',apply);
  platSel.addEventListener('change',apply);
  apply();
})();
`;
