#!/usr/bin/env node
/* Build the two course pages from course/_data/courses.json.
 *
 *   node build_course_pages.mjs        # rewrite both pages
 *   node build_course_pages.mjs --check  # verify the pages match the data
 *
 * WHY A GENERATOR. The chapter list on a course page is 112 hand-written
 * lesson rows, and the counts ("N lessons out now", "N of M released", the
 * hours, the free-lesson mentions) appear in a dozen places. Every time a
 * chapter ships the page went stale somewhere — "18 lessons out" was live
 * while 99 were. Now the data file is refreshed from the database
 * (scripts/courses_data.mjs in the app repo, or by hand) and this script
 * rewrites every derived number and row. Copy that is not derived from data
 * lives in this file as templates.
 *
 * Port to Port keeps its hand-authored sections (why / teacher / built for a
 * ship) and gets its chapters, numbers, enrol block, FAQ and structured data
 * regenerated. The Other Half page is produced from the Port to Port page as
 * its template, with every course-specific block replaced.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const data = JSON.parse(readFileSync('course/_data/courses.json', 'utf8'));
const APP = 'https://app.seamanapp.com';
const PRO_URL = `${APP}/#/pro`;
// The two Port to Port previews whose Cloudflare Stream copies were made
// public for this page (2026-09-06). Every other free lesson plays in the app.
const PUBLIC_STREAM = new Set(['9f5d43e38407d65de961389d4a5496bc', '341f9bbc0aaafc7ba1b847cc44b97db6']);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mmss = (sec) => `${Math.floor((sec || 0) / 60)}:${String((sec || 0) % 60).padStart(2, '0')}`;
const hoursText = (sec) => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
const isoDur = (sec) => `PT${Math.floor(sec / 3600)}H${Math.round((sec % 3600) / 60)}M`;

function stats(course) {
  const ls = course.lessons;
  const released = ls.filter((l) => l.status === 'released' && l.video);
  const secs = released.reduce((a, l) => a + (l.duration_sec || 0), 0);
  const chapters = [...new Set(ls.map((l) => l.ch))].length;
  const chaptersOut = [...new Set(released.map((l) => l.ch))].length;
  const free = ls.filter((l) => l.free_preview);
  return { total: ls.length, released: released.length, secs, chapters, chaptersOut, free, pct: Math.round(released.length * 100 / ls.length) };
}

function code(l) { return l.title.split(' ')[0]; }
function name(l) { return l.title.slice(code(l).length + 1); }

function lessonRow(l, appCourseUrl) {
  const c = code(l), img = `<img src="img/lessons/${c}.webp" alt="" width="560" height="315" loading="lazy" decoding="async" />`;
  const live = l.status === 'released' && l.video;
  if (live && l.free_preview && l.stream_uid && PUBLIC_STREAM.has(l.stream_uid)) {
    return `      <li class="lesson free" id="free-${c}">
        <div class="row"><span class="thumb">${img}</span>
          <span class="t"><b>${esc(name(l))}</b><span class="meta">${c} · ${mmss(l.duration_sec)} · <em>Free preview — watch it here</em></span></span>
          <span class="tag freetag">▶ Free</span></div>
        <div class="player" data-uid="${l.stream_uid}">
          <button type="button" class="play" data-uid="${l.stream_uid}" aria-label="Play ${esc(name(l))}">
            ${img}
            <span class="playbtn">▶</span><span class="playlabel">Watch free · ${mmss(l.duration_sec)}</span>
          </button>
        </div>
      </li>`;
  }
  if (live && l.free_preview) {
    return `      <li class="lesson free"><a class="row" href="${appCourseUrl}" style="text-decoration:none"><span class="thumb">${img}</span>
          <span class="t"><b>${esc(name(l))}</b><span class="meta">${c} · ${mmss(l.duration_sec)} · <em>Free preview — watch it in the app</em></span></span><span class="tag freetag">▶ Free</span></a></li>`;
  }
  if (live) {
    return `      <li class="lesson"><div class="row"><span class="thumb">${img}</span>
          <span class="t"><b>${esc(name(l))}</b><span class="meta">${c} · ${mmss(l.duration_sec)}</span></span><span class="tag lock">🔒</span></div></li>`;
  }
  return `      <li class="lesson"><div class="row"><span class="thumb">${img}</span>
          <span class="t"><b>${esc(name(l))}</b><span class="meta">${c} · in production</span></span><span class="tag soon">Coming</span></div></li>`;
}

function chapterBlocks(course, appCourseUrl, openCh) {
  const byCh = new Map();
  for (const l of course.lessons) { if (!byCh.has(l.ch)) byCh.set(l.ch, []); byCh.get(l.ch).push(l); }
  const out = [];
  for (const [ch, ls] of byCh) {
    const title = ls[0].chapter.replace(/^[A-Z0-9]+ — /, '');
    const no = ls[0].chapter.split(' — ')[0];
    const lane = /^L[A-Z]$/.test(no);
    const rel = ls.filter((l) => l.status === 'released' && l.video).length;
    const free = ls.filter((l) => l.free_preview).length;
    const pill = rel === ls.length ? '<span class="pill out">Out now</span>' : rel > 0 ? `<span class="pill part">${rel} of ${ls.length} out</span>` : '<span class="pill prod">In production</span>';
    const freePill = free ? ` <span class="pill free">${free} free</span>` : '';
    out.push(`  <details class="chapter${lane ? ' lane' : ''}"${ch === openCh ? ' open' : ''}>
    <summary>
      <span class="chthumb"><img src="img/lessons/${code(ls[0])}.webp" alt="" width="560" height="315" loading="lazy" decoding="async" /></span>
      <span class="chno">${no}</span>
      <span class="chtitle"><b>${esc(title)}</b><span class="chmeta">${ls.length} lessons ${pill}${freePill}</span></span>
      <span class="chev">›</span>
    </summary>
    <ul class="lessons">
${ls.map((l) => lessonRow(l, appCourseUrl)).join('\n')}
    </ul>
  </details>`);
  }
  return out.join('\n');
}

function replaceChapters(html, blocks) {
  const start = html.indexOf('<div class="chapters">');
  const why = html.indexOf('<div class="eyebrow kicker">Why this exists');
  if (start < 0 || why < 0) throw new Error('chapter container markers not found');
  const endTag = '  </details>\n';
  const end = html.lastIndexOf(endTag, why) + endTag.length;
  return html.slice(0, start + '<div class="chapters">\n'.length) + blocks + '\n' + html.slice(end);
}

function replaceBetween(html, startMarker, endMarker, replacement) {
  const a = html.indexOf(startMarker), b = html.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`markers not found: ${startMarker.slice(0, 40)}`);
  return html.slice(0, a) + replacement + html.slice(b);
}

function must(html, pairs) {
  for (const [from, to] of pairs) {
    if (!html.includes(from)) throw new Error(`expected text not found: ${from.slice(0, 70)}`);
    html = html.split(from).join(to);
  }
  return html;
}

/* ─────────────────────────── Seaman Pro copy ─────────────────────────── */
const PRO_PRICE_LINE = 'Monthly or annual. On the web it is <b>$9.99 a month</b> or <b>$99.90 a year</b> through PayPal; in the Android app it is billed by Google Play, priced for your country.';
const PRO_INCLUDES = (other) => `<li>Port to Port and The Other Half — every English course, every lesson</li>
        <li>Every course we add to the library while you subscribe</li>
        <li>Two devices, downloads for the passage, the Pro navigation tools</li>
        <li>${other}</li>`;

/* ─────────────────────────── Port to Port ─────────────────────────── */
const P2P = data['Port to Port'];
const p2pStats = stats(P2P);
const p2pApp = `${APP}/#/courses/${P2P.id}`;
// The pages are CRLF on disk (the repo's convention); work in LF, write back CRLF.
const raw = readFileSync('course/port-to-port/index.html', 'utf8');
const CRLF = raw.includes(String.fromCharCode(13, 10));
let p2p = raw.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const p2pOut = `${p2pStats.released} lessons`;
const p2pHours = hoursText(p2pStats.secs);
const lanesLeft = p2pStats.chapters - p2pStats.chaptersOut;

p2p = replaceChapters(p2p, chapterBlocks(P2P, p2pApp, 3));
p2p = must(p2p, [
  // head
  [/18 lessons out now, two of them free to watch on this page\. 19 chapters as they are finished\.\./.source === '' ? '' : '18 lessons out now, two of them free to watch on this page. 19 chapters as they are finished..',
   `${p2pStats.released} of 112 lessons out now — ${p2pStats.free.length} of them free, two right on this page. Included in Seaman Pro, or own it outright.`],
  ['18 lessons out now, two free to watch. 19 chapters as they land..', `${p2pStats.released} lessons out now, ${p2pStats.free.length} free. Included in Seaman Pro.`],
  // hero
  ['<b style="color:var(--ink)">18</b> of 112 lessons released</span><span class="bar"><i style="width:16%"></i></span><span>2 h 32 min out now</span>',
   `<b style="color:var(--ink)">${p2pStats.released}</b> of ${p2pStats.total} lessons released</span><span class="bar"><i style="width:${p2pStats.pct}%"></i></span><span>${p2pHours} out now</span>`],
  ['Two lessons are open to everyone — no account, no card. The rest unlock when you enrol.',
   `${p2pStats.free.length} lessons are free — these two play right here, all ${p2pStats.free.length} in the app with a free account, no card. The rest unlock with Seaman Pro, or when you buy the course.`],
  ['Tap a chapter to see its lessons. Chapter 03 is open — it holds the two free lessons.',
   `Tap a chapter to see its lessons. Chapter 03 is open — it holds two of the ${p2pStats.free.length} free lessons; the others are marked ▶ Free.`],
  // built for a ship
  ['<h3>Watch it again</h3><p>Two years of access. Come back to the arrival chapter the night before you actually do one — that is when it means the most.</p>',
   '<h3>Watch it again</h3><p>Yours for as long as you subscribe — or for two years if you buy the course outright. Come back to the arrival chapter the night before you actually do one — that is when it means the most.</p>'],
  // how
  ['<div class="step"><h3>Enrol</h3><p>Scan the QR Ph code with GCash, Maya or your bank app, and create your free Seaman&nbsp;App account with the same email.</p></div>',
   '<div class="step"><h3>Subscribe, or buy the course</h3><p>Create a free Seaman&nbsp;App account. Subscribe to Seaman Pro for the whole library, or pay once for this course by scanning the QR Ph code with GCash, Maya or your bank app.</p></div>'],
  [`<div class="step"><h3>Learn at sea</h3><p>Start with the 18 lessons that are out. Download them in port and study them on passage, offline. New chapters appear as they are finished.</p></div>`,
   `<div class="step"><h3>Learn at sea</h3><p>Start with the ${p2pStats.released} lessons that are out. Download them in port and study them on passage, offline. The remaining chapters appear as they are finished.</p></div>`],
  // footer
  ['18 lessons out now, 19 chapters as they land. One voyage, last line to first line.',
   `${p2pStats.released} lessons out now — ${p2pStats.chaptersOut} of ${p2pStats.chapters} chapters. One voyage, last line to first line.`],
  ['<a class="btn gold lg" href="https://app.seamanapp.com/#/courses/88a59975-14d7-4acb-8a33-ae366d1893ed?pay=paymongo">Enrol now — ₱3,250</a>\n    </div>',
   `<a class="btn gold lg" href="${PRO_URL}">Subscribe to Seaman Pro</a>\n      <p class="fineprint" style="margin-top:10px">or <a href="#enrol" style="color:var(--cyan)">own the course for ₱3,250</a></p>\n    </div>`],
  // structured data
  ['"courseWorkload":"PT2H32M"', `"courseWorkload":"${isoDur(p2pStats.secs)}"`],
  ['"offers":{"@type":"Offer","price":"3250","priceCurrency":"PHP","availability":"https://schema.org/InStock","url":"https://course.seamanapp.com/#enrol"}',
   '"offers":[{"@type":"Offer","name":"Seaman Pro subscription (monthly)","price":"9.99","priceCurrency":"USD","availability":"https://schema.org/InStock","url":"https://course.seamanapp.com/#enrol"},{"@type":"Offer","name":"Own the course — two years","price":"3250","priceCurrency":"PHP","availability":"https://schema.org/InStock","url":"https://course.seamanapp.com/#enrol"}]'],
]);

// Enrol section: the subscription first, the one-off second.
p2p = replaceBetween(p2p, '<!-- ENROL', '<!-- HOW IT WORKS -->', `<!-- ENROL — the price appears here, after the course has made its own case -->
<section id="enrol">
  <div class="wrap pricing">
    <div class="eyebrow kicker center">Enrol</div>
    <h2 style="margin-bottom:.35em">Two ways in.</h2>
    <p class="sub" style="margin:0 auto 18px">Port to Port is part of the <b>Seaman Pro</b> library, together with <a href="https://seamanapp.com/course/the-other-half/" style="color:var(--cyan)">The Other Half</a>. Subscribe and both are yours, plus everything we add — or pay once and own just this course.</p>
    <div class="pricebox">
      <div class="eyebrow" style="margin-bottom:6px">Recommended</div>
      <div><span class="amt">Seaman Pro</span></div>
      <p style="color:var(--muted);font-size:14px;margin:10px 0 0">${PRO_PRICE_LINE}</p>
      <ul class="incl">
        ${PRO_INCLUDES(`${p2pStats.released} lessons of Port to Port out today — ${p2pHours} — and every remaining chapter as it is finished`)}
      </ul>
      <a class="btn gold lg block" href="${PRO_URL}">Subscribe to Seaman Pro</a>
      <p class="fineprint">No free trial — the ${p2pStats.free.length} free lessons are the taster. Cancel any time.</p>
    </div>
    <div class="pricebox" style="margin-top:22px">
      <div class="eyebrow" style="margin-bottom:6px">Or own just this course</div>
      <div><span class="amt">&#8369;3,250</span><span class="was">&#8369;17,000</span></div>
      <p style="color:var(--muted);font-size:14px;margin:10px 0 0">One payment, two years of access to Port to Port only. The price while the course is still being built.</p>
      <ul class="incl">
        <li>${p2pStats.released} lessons watchable today — ${p2pHours}</li>
        <li>Every remaining chapter as it is finished</li>
        <li>Two years of access from the day you enrol</li>
        <li>Bulk, tanker and container lanes for your ship</li>
      </ul>
      <a class="btn ghost lg block" href="${p2pApp}?pay=paymongo">Buy Port to Port &mdash; &#8369;3,250</a>
      <p class="fineprint"><span class="qr-tag">&#9635; QR Ph</span> Scan with GCash, Maya or any bank app.</p>
      <p class="fineprint" style="margin-top:10px">Outside the Philippines? <a href="${p2pApp}?pay=paypal" style="color:var(--cyan)">Pay $50 with PayPal</a></p>
      <p class="fineprint" style="margin-top:10px">Would rather send the money to a person? <a href="gcash/" style="color:var(--cyan)">We can enrol you by hand</a>.</p>
    </div>
    <div class="note">
      Peer-to-peer mentorship, not approved or assessed training. It confers no certificate and no STCW endorsement, nothing is marked or scored, and it does not replace your company's safety-management system or the officer teaching you onboard.
    </div>
  </div>
</section>

`);

// FAQ: rewritten wholesale — every answer carried a number.
p2p = replaceBetween(p2p, '<!-- FAQ -->', '<!-- FOOTER -->', `<!-- FAQ -->
<section id="faq">
  <div class="wrap" style="max-width:760px">
    <div class="eyebrow kicker">Questions</div>
    <h2>Good to know</h2>
    <details open><summary>How much of the course is finished?</summary><p>${p2pStats.released} of ${p2pStats.total} lessons — about ${p2pHours} — are complete and watchable now: ${p2pStats.chaptersOut} of the ${p2pStats.chapters} chapters, the whole voyage from the introduction to "When They Come Aboard". Only the ${lanesLeft} ship-type lanes (bulk, tanker, container) are still in production, and they appear in your account as they are finished.</p></details>
    <details><summary>What is Seaman Pro?</summary><p>One subscription for the English course library in the Seaman App: Port to Port, The Other Half, and every course we add. ${PRO_PRICE_LINE} There is no free trial; the ${p2pStats.free.length} free lessons on this course are the taster.</p></details>
    <details><summary>Should I subscribe or buy the course?</summary><p>If you want only Port to Port and plan to take your time, buy it once for ₱3,250 and keep it for two years. If you want The Other Half too, or want everything we add, Seaman Pro is cheaper by the end of the first month.</p></details>
    <details><summary>When will the rest be released?</summary><p>Chapters are filmed and released in voyage order, and we publish each one when it is finished rather than promising a date we might miss. Two years of access — or a subscription — comfortably covers the build.</p></details>
    <details><summary>Is this a certificate or STCW course?</summary><p>No. It's honest peer-to-peer mentorship from a serving officer. It confers no certificate and no endorsement, and it doesn't replace your company's SMS or the officer teaching you onboard. It's the conversation the certificates assume you already had.</p></details>
    <details><summary>Can I study offline?</summary><p>Yes. Download the videos in port on the Android app and watch them mid-ocean. The whole app is built offline-first for a ship's connection.</p></details>
    <details><summary>Who is it for?</summary><p>Entry to intermediate — cadets, new OOWs, and anyone who knows the theory but wants to know how the watch actually runs. There are dedicated lanes for bulk, tanker and container ships.</p></details>
    <details><summary>How do I pay?</summary><p>Seaman Pro: subscribe in the app — Google Play on Android, PayPal on the web. Buying the course outright: tap <b>Buy Port to Port</b> and scan the QR&nbsp;Ph code with GCash, Maya or any bank app; your access unlocks by itself, usually within a minute. Paying from outside the Philippines? PayPal is $50. And if you would rather send the money to a person, <a href="gcash/" style="color:var(--cyan)">we can enrol you by hand</a>.</p></details>
  </div>
</section>

`);

/* ─────────────────────────── The Other Half ─────────────────────────── */
const OH = data['The Other Half'];
const ohStats = stats(OH);
const ohApp = `${APP}/#/courses/${OH.id}`;
const ohHours = hoursText(ohStats.secs);
const OH_URL = 'https://seamanapp.com/course/the-other-half/';
const ohDesc = OH.description.trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim());

let oh = p2p;
// head
oh = must(oh, [
  ['<title>Port to Port — a full navigation course, last line to first line</title>', '<title>The Other Half — a Third Officer\'s job, outside the watch</title>'],
  ['<link rel="canonical" href="https://course.seamanapp.com/" />', `<link rel="canonical" href="${OH_URL}" />`],
  ['<meta property="og:title" content="Port to Port — a full navigation course" />', '<meta property="og:title" content="The Other Half — a Third Officer\'s job, outside the watch" />'],
  ['<meta property="og:url" content="https://course.seamanapp.com/" />', `<meta property="og:url" content="${OH_URL}" />`],
  ['<meta property="og:image" content="https://course.seamanapp.com/img/cover.webp" />', `<meta property="og:image" content="${OH_URL}img/lessons/cover.webp" />`],
  ['<meta property="og:image:width" content="1400" />', '<meta property="og:image:width" content="560" />'],
  ['<meta property="og:image:height" content="788" />', '<meta property="og:image:height" content="315" />'],
  ['<meta name="twitter:title" content="Port to Port — a full navigation course" />', '<meta name="twitter:title" content="The Other Half — a Third Officer\'s job, outside the watch" />'],
  ['<meta name="twitter:description" content="One voyage, last line to first line. Taught by a serving 2/O.." />', `<meta name="twitter:description" content="The port documents, the crew change, the drills, the requisitions, the inspector at the gangway — ${ohStats.total} lessons, all out now. Included in Seaman Pro." />`],
  ['<meta name="twitter:image" content="https://course.seamanapp.com/img/cover.webp" />', `<meta name="twitter:image" content="${OH_URL}img/lessons/cover.webp" />`],
  ['<link rel="icon" href="img/app-icon.png" />', '<link rel="icon" href="../port-to-port/img/app-icon.png" />'],
  ['<link rel="apple-touch-icon" href="img/app-icon.png" />', '<link rel="apple-touch-icon" href="../port-to-port/img/app-icon.png" />'],
  ['<link rel="preload" as="image" href="img/cover.webp" />', '<link rel="preload" as="image" href="img/lessons/cover.webp" />'],
]);
oh = oh.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="Every third officer is trained to keep a watch. Almost none are trained for the rest of the day — the port documents, the crew change, the muster list, the drills, the requisitions, the bonded store, the inspector at the gangway. ${ohStats.total} lessons, all out now, taught by a working officer. Included in Seaman Pro." />`);
oh = oh.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="A Third Officer's job outside the watch — one ship, one month, in the order it happens, with the real forms on screen. ${ohStats.total} lessons, all out now. Included in Seaman Pro." />`);

// hero
oh = replaceBetween(oh, '<div class="coursehead">', '<div id="chapters"', `<div class="coursehead">
      <div>
        <div class="eyebrow">Seaman&nbsp;App&nbsp;·&nbsp;Simplified&nbsp;Maritime</div>
        <h1>The Other&nbsp;Half</h1>
        <p class="lede">${esc(OH.subtitle)} — one ship, one month, in the order it actually happens.</p>
        <p class="desc">${esc(ohDesc[0])} ${esc(ohDesc[1])}</p>
        <div class="ratingbar"><span class="pill out">All ${ohStats.total} lessons out</span><span style="color:var(--muted)">· ${ohStats.chapters} chapters · ${ohHours}</span></div>
        <div class="progressline"><span><b style="color:var(--ink)">${ohStats.released}</b> of ${ohStats.total} lessons released</span><span class="bar"><i style="width:${ohStats.pct}%"></i></span><span>${ohHours} out now</span></div>
        <div class="freecta"><a class="btn gold" href="${ohApp}">▶ Watch 00.1 free in the app</a> <a class="btn ghost" href="#enrol">Included in Seaman Pro</a></div>
        <p style="color:var(--muted);font-size:13px;margin:12px 0 0">The first lesson is free with a free account. Every lesson after it is part of Seaman Pro.</p>
      </div>
      <div class="cover"><img src="img/lessons/cover.webp" alt="The Other Half" width="560" height="315" decoding="async" fetchpriority="high" /></div>
    </div>

    `);
oh = must(oh, [
  [`<div id="chapters" class="eyebrow kicker" style="margin-top:44px">Curriculum · 19 chapters</div>`, `<div id="chapters" class="eyebrow kicker" style="margin-top:44px">Curriculum · ${ohStats.chapters} chapters</div>`],
  [`Tap a chapter to see its lessons. Chapter 03 is open — it holds two of the ${p2pStats.free.length} free lessons; the others are marked ▶ Free.`, 'Tap a chapter to see its lessons. Chapter 00 is open — it holds the free lesson.'],
]);
oh = replaceChapters(oh, chapterBlocks(OH, ohApp, 0));

// why this exists
oh = replaceBetween(oh, '<div class="eyebrow kicker">Why this exists</div>', '<!-- TEACHER -->', `<div class="eyebrow kicker">Why this exists</div>
    <p class="lead-quote">You were trained to keep <b>the watch</b>.<br />
      Nobody trained you for the rest of the day — and the rest of the day is what gets a ship detained.</p>
    <div class="grid g3" style="margin-top:34px">
      <div class="card"><div class="ic">🗂️</div><h3>The real forms, on screen</h3><p>Port declarations, the muster list, the drill report, the requisition, the bonded-store account — filled in the way they are actually filled in, with the reason behind each line.</p></div>
      <div class="card"><div class="ic">📅</div><h3>One ship, one month</h3><p>A handover in Singapore, a crew change the same week, a month end at sea, a port call and an inspector at the gangway — in the order they happen, not a syllabus sorted by subject.</p></div>
      <div class="card"><div class="ic">✍️</div><h3>You do it, nobody marks it</h3><p>Every lesson ends with something real to do on your own ship, photographed by you. Where a shortcut exists you are told what it costs and who has to approve it.</p></div>
    </div>
  </div>
</section>

`);
oh = must(oh, [
  ['<h2>A serving Second Officer, not a retired lecturer.</h2>', '<h2>A working officer who did the job, not a retired lecturer.</h2>'],
  ['<p class="sub">Someone who stood the watch this contract — who knows what the Master will call you about at 0200, which alarm you will learn to ignore and why that is the dangerous one, and what a pilot expects to find when he steps onto your bridge.</p>',
   '<p class="sub">Someone who carried the third officer\'s file this contract — who knows which document the agent asks for first, what the flag inspector opens, which requisition comes back wrong and why, and what the surveyor is really looking at when he asks to see the lifeboat inventory.</p>'],
  ['Port to Port is that same voice, written down properly and filmed.', 'The Other Half is that same voice, written down properly and filmed.'],
  ['<figure><img src="img/g-08.1.webp"', '<figure><img src="../port-to-port/img/g-08.1.webp"'],
  ['<h3>Watch it again</h3><p>Yours for as long as you subscribe — or for two years if you buy the course outright. Come back to the arrival chapter the night before you actually do one — that is when it means the most.</p>',
   '<h3>Watch it again</h3><p>Yours for as long as you subscribe. Come back to the port-formalities chapter the night before your next arrival — that is when it means the most.</p>'],
]);

// enrol: subscription only — this course is not sold on its own.
oh = replaceBetween(oh, '<!-- ENROL', '<!-- HOW IT WORKS -->', `<!-- ENROL — the price appears here, after the course has made its own case -->
<section id="enrol">
  <div class="wrap pricing">
    <div class="eyebrow kicker center">Enrol</div>
    <h2 style="margin-bottom:.35em">Included in Seaman Pro.</h2>
    <p class="sub" style="margin:0 auto 18px">The Other Half is part of the Seaman Pro library, together with <a href="https://course.seamanapp.com/" style="color:var(--cyan)">Port to Port</a>. One subscription, both courses, and everything we add.</p>
    <div class="pricebox">
      <div><span class="amt">Seaman Pro</span></div>
      <p style="color:var(--muted);font-size:14px;margin:10px 0 0">${PRO_PRICE_LINE}</p>
      <ul class="incl">
        ${PRO_INCLUDES(`All ${ohStats.total} lessons of The Other Half — ${ohHours} — out today`)}
      </ul>
      <a class="btn gold lg block" href="${PRO_URL}">Subscribe to Seaman Pro</a>
      <p class="fineprint">No free trial — the first lesson is free with a free account. Cancel any time.</p>
      <p class="fineprint" style="margin-top:10px">Subscribed already? <a href="${ohApp}" style="color:var(--cyan)">Open the course in the app</a>.</p>
    </div>
    <div class="note">
      Peer-to-peer mentorship, not approved or assessed training. It confers no certificate and no STCW endorsement, nothing is marked or scored, and it does not replace your company's safety-management system or the officer teaching you onboard. Most of this has no regulation behind it, and the course says so.
    </div>
  </div>
</section>

`);
oh = replaceBetween(oh, '<!-- HOW IT WORKS -->', '<!-- FAQ -->', `<!-- HOW IT WORKS -->
<section id="how" style="background:var(--navy2)">
  <div class="wrap">
    <div class="eyebrow kicker">How to start</div>
    <h2>Three steps to the other half</h2>
    <div class="steps">
      <div class="step"><h3>Subscribe</h3><p>Create a free Seaman&nbsp;App account and subscribe to Seaman Pro — Google Play in the Android app, PayPal on the web.</p></div>
      <div class="step"><h3>Open the course</h3><p>Install the Seaman&nbsp;App on Android and sign in — that is where the videos play. The reading and your progress are on the web too.</p></div>
      <div class="step"><h3>Do it on your ship</h3><p>All ${ohStats.total} lessons are out. Download them in port, watch on passage, and do the thing each lesson ends with on your own vessel.</p></div>
    </div>
  </div>
</section>

`);
oh = replaceBetween(oh, '<!-- FAQ -->', '<!-- FOOTER -->', `<!-- FAQ -->
<section id="faq">
  <div class="wrap" style="max-width:760px">
    <div class="eyebrow kicker">Questions</div>
    <h2>Good to know</h2>
    <details open><summary>Is the course finished?</summary><p>Yes. All ${ohStats.total} lessons across ${ohStats.chapters} chapters — about ${ohHours} — are released and watchable the moment you subscribe.</p></details>
    <details><summary>What is Seaman Pro?</summary><p>One subscription for the English course library in the Seaman App: The Other Half, Port to Port, and every course we add. ${PRO_PRICE_LINE} There is no free trial; the first lesson is free with a free account.</p></details>
    <details><summary>Can I buy just this course?</summary><p>Not on its own — it comes with Seaman Pro, which also includes Port to Port. If you only want a single course to own outright, Port to Port is sold that way for ₱3,250.</p></details>
    <details><summary>Is this a certificate or STCW course?</summary><p>No. It's peer-to-peer mentorship from a working officer. It confers no certificate and no endorsement, nothing is marked, and it doesn't replace your company's safety-management system. Where a convention settles a question it is named; where it doesn't, you are told plainly that this is one officer's practice and the reasoning under it.</p></details>
    <details><summary>Can I study offline?</summary><p>Yes. Download the videos in port on the Android app and watch them mid-ocean. The whole app is built offline-first for a ship's connection.</p></details>
    <details><summary>Who is it for?</summary><p>New and soon-to-be third officers, and cadets who want to know what the job is before they hold it. Second officers who never had this handover will recognise most of it.</p></details>
  </div>
</section>

`);
oh = must(oh, [
  ['<h2 style="margin-top:0">Sail your first voyage the right way</h2>', '<h2 style="margin-top:0">Learn the half of the job nobody taught you</h2>'],
  [`${p2pStats.released} lessons out now — ${p2pStats.chaptersOut} of ${p2pStats.chapters} chapters. One voyage, last line to first line.`, `All ${ohStats.total} lessons out now. One ship, one month, in the order it happens.`],
  ['<p class="fineprint" style="margin-top:10px">or <a href="#enrol" style="color:var(--cyan)">own the course for ₱3,250</a></p>', ''],
  ['"name":"Port to Port"', '"name":"The Other Half"'],
  ['"description":"A full navigation course — the last line ashore to the first line at the next port, in the order it really happens. Taught by a serving Second Officer."', `"description":"A Third Officer's job outside the watch — one ship, one month, in the order it happens, with the real forms on screen. Taught by a working officer."`],
  ['"url":"https://course.seamanapp.com/"', `"url":"${OH_URL}"`],
  ['"image":"https://course.seamanapp.com/img/cover.webp"', `"image":"${OH_URL}img/lessons/cover.webp"`],
  [`"courseWorkload":"${isoDur(p2pStats.secs)}"`, `"courseWorkload":"${isoDur(ohStats.secs)}"`],
  ['"offers":[{"@type":"Offer","name":"Seaman Pro subscription (monthly)","price":"9.99","priceCurrency":"USD","availability":"https://schema.org/InStock","url":"https://course.seamanapp.com/#enrol"},{"@type":"Offer","name":"Own the course — two years","price":"3250","priceCurrency":"PHP","availability":"https://schema.org/InStock","url":"https://course.seamanapp.com/#enrol"}]',
   `"offers":{"@type":"Offer","name":"Seaman Pro subscription (monthly)","price":"9.99","priceCurrency":"USD","availability":"https://schema.org/InStock","url":"${OH_URL}#enrol"}`],
]);
// The Other Half has no by-hand GCash page of its own.
oh = oh.replace(/<a href="gcash\/"/g, '<a href="https://seamanapp.com/course/port-to-port/gcash/"');

/* ─────────────────────────── write / check ─────────────────────────── */
const targets = [['course/port-to-port/index.html', p2p], ['course/the-other-half/index.html', oh]];
let stale = 0;
for (const [file, html] of targets) {
  // every cover referenced must exist beside the page
  const dir = file.replace(/index\.html$/, '');
  for (const m of html.matchAll(/src="(img\/lessons\/[^"]+)"/g)) {
    if (!existsSync(dir + m[1])) throw new Error(`${file}: missing ${m[1]}`);
  }
  const opens = (html.match(/<details/g) || []).length, closes = (html.match(/<\/details>/g) || []).length;
  if (opens !== closes) throw new Error(`${file}: <details> ${opens} vs </details> ${closes}`);
  const out = CRLF ? html.split(String.fromCharCode(10)).join(String.fromCharCode(13, 10)) : html;
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current !== out) { stale++; if (!CHECK) writeFileSync(file, out); }
  console.log(`${CHECK ? (current === html ? 'ok     ' : 'STALE  ') : 'written'} ${file}  (${(html.length / 1024).toFixed(0)} KB, ${opens} chapters)`);
}
console.log(`Port to Port: ${p2pStats.released}/${p2pStats.total} released, ${p2pHours}, ${p2pStats.free.length} free · The Other Half: ${ohStats.released}/${ohStats.total}, ${ohHours}, ${ohStats.free.length} free`);
if (CHECK && stale) process.exitCode = 1;
