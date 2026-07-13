/* ============================================================================
   Navigators Club web app — auth → membership gate → courses → protected
   lesson player, over the SAME prod Supabase project the Seaman App uses.

   No build step. Vendored @supabase/supabase-js (v2 UMD) + hls.js live in
   ./vendor/ so this page never makes a runtime request to a CDN. The anon
   key below is the PUBLIC "publishable" key — safe to embed client-side;
   every table/RPC/edge-function it touches is governed by Postgres RLS on
   the server, the same boundary the Flutter app relies on.
   ========================================================================== */

// ── Config ──────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://iegxzjflqqoxxarfomnv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_we44OUTEJHf3kacz0Opi4w_TBWkj0Q2';
const NAV_CLUB_ID = '22222222-2222-2222-2222-222222222201';

// The UMD bundle exposes a global `supabase` object with `.createClient`.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ── App state ───────────────────────────────────────────────────────────
const state = {
  user: null,
  membershipId: null,   // the caller's seafarer membership id
  courses: [],
  currentCourse: null,
  modules: [],
  lessons: [],
  enrolled: false,
  mediaUrlCache: new Map(),  // lessonId -> { url, exp }  (R2 signed URL)
  streamUrlCache: new Map(), // lessonId -> { url, exp }  (Cloudflare Stream signed HLS)
  watermarkTimer: null,
  currentGuide: null,
  lbScope: 'week',
};

// ── View switching ──────────────────────────────────────────────────────
const VIEWS = [
  'loading', 'login', 'forgot', 'gate', 'courses', 'course', 'lesson',
  'guides', 'guide', 'community', 'leaderboard', 'club',
];
// The top-level tabs the bottom nav switches between — everything else
// (login/gate/course-detail/lesson/guide-reader/…) is a drill-down that keeps
// its own back button and hides the tab bar, same pattern the app already
// used for course → lesson.
const TAB_VIEWS = ['courses', 'guides', 'community', 'leaderboard', 'club'];

function showView(name) {
  for (const v of VIEWS) {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('hidden', v !== name);
  }
  updateChrome(name);
  window.scrollTo(0, 0);
}

function updateChrome(name) {
  const nav = document.getElementById('bottomNav');
  const showNav = TAB_VIEWS.includes(name);
  if (nav) nav.classList.toggle('hidden', !showNav);
  document.body.classList.toggle('with-nav', showNav);
  if (showNav) {
    document.querySelectorAll('#bottomNav .navbtn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === name);
    });
  }
}

/** Switches to a bottom-nav tab, (re)loading its data. Cache-first inside
 * each loader, so re-tapping a tab you've already visited this session is
 * instant, then refreshes quietly in the background. */
function openTab(name) {
  if (name === 'courses') return loadCourses();
  if (name === 'guides') return loadGuides();
  if (name === 'community') return loadFeed();
  if (name === 'leaderboard') return loadLeaderboard(state.lbScope || 'week');
  if (name === 'club') return loadClubHome();
}
function setLoadingLine(text) {
  const el = document.getElementById('loadingLine');
  if (el) el.textContent = text;
}

// ── Small helpers ───────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** A tiny, safe-by-construction Markdown → HTML renderer (headings, bold,
 * italics, inline code, links, unordered lists, blockquotes, horizontal
 * rules, paragraphs). Escapes everything first, so lesson/guide text can
 * never inject a script tag or attribute. Enough for mentor lesson text and
 * the field guides (their figures render as plain "*Figure — Caption*"
 * placeholders, not raw markup) — not a full CommonMark implementation. */
function renderMarkdown(md) {
  const lines = escapeHtml(md || '').split(/\r?\n/);
  let html = '';
  let inList = false;
  let inQuote = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const closeQuote = () => { if (inQuote) { html += '</blockquote>'; inQuote = false; } };
  const inline = (t) => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); closeQuote(); continue; }
    let m;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { closeList(); closeQuote(); html += '<hr/>'; continue; }
    // '>' was already escaped to '&gt;' above — match the escaped form.
    if ((m = line.match(/^&gt;\s?(.*)$/))) {
      closeList();
      if (!inQuote) { html += '<blockquote>'; inQuote = true; }
      html += `<p>${inline(m[1])}</p>`;
      continue;
    }
    closeQuote();
    if ((m = line.match(/^### (.*)$/))) { closeList(); html += `<h3>${inline(m[1])}</h3>`; continue; }
    if ((m = line.match(/^## (.*)$/))) { closeList(); html += `<h2>${inline(m[1])}</h2>`; continue; }
    if ((m = line.match(/^# (.*)$/))) { closeList(); html += `<h1>${inline(m[1])}</h1>`; continue; }
    if ((m = line.match(/^[-*] (.*)$/))) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  closeQuote();
  return html;
}

function contentIcon(type) {
  return { video: '▶', pdf: '📄', markdown: '📝', file: '📎', link: '🔗' }[type] || '•';
}

// ── Rank / department label helpers (ports of lib/features/profile/rank.dart
// so the web feed/leaderboard read the same as the app — same rules, same
// output, independently reproduced since this is a separate static site). ──
function rankLabel(code) {
  return String(code || '')
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
function channelLabel(s) {
  const v = (s || '').trim();
  if (!v) return v;
  return v[0].toUpperCase() + v.slice(1).toLowerCase();
}
function prettyRankHeadline(s) {
  const v = (s || '').trim();
  if (!v) return v;
  return /^[a-z]+(_[a-z]+)*$/.test(v) ? rankLabel(v) : v;
}
function timeAgo(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Math.max(0, Date.now() - d.getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return d.toLocaleDateString();
}

// ── Offline data cache (the owner's main complaint: opening offline showed
// nothing) ──────────────────────────────────────────────────────────────
// localStorage, namespaced. Every tab's loader is "cache-first, then
// refresh": render the last-known copy instantly (no spinner) if we have
// one, quietly refetch, and only show a spinner on a first-ever, cold load.
// On a failed refetch we keep showing the cached copy with a small
// "offline — showing saved copy" note instead of an error screen. The
// service worker (sw.js) separately caches the app SHELL (html/css/js); this
// is the DATA layer on top of that, which is what actually makes a
// previously-opened guide/feed/leaderboard/club page readable with no
// connection.
const CACHE_PREFIX = 'ncw:1:'; // bump the "1" if the cached shape ever changes
function cacheSet(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ v: value, t: Date.now() }));
  } catch (_) {
    // Storage full / unavailable (e.g. Safari private mode) — non-fatal,
    // the tab simply won't have an offline copy this time.
  }
}
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Object.prototype.hasOwnProperty.call(parsed, 'v') ? parsed.v : null;
  } catch (_) {
    return null;
  }
}
function clearDataCache() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(CACHE_PREFIX) === 0) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch (_) {}
}

// ── Auth ────────────────────────────────────────────────────────────────
async function boot() {
  registerServiceWorker();
  maybeShowInstallBanner();
  maybeShowInstallButton();
  wireStaticHandlers();

  showView('loading');
  setLoadingLine('Checking your session…');

  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    await afterLogin(session.user);
  } else {
    showView('login');
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      resetAppState();
      showView('login');
    }
  });
}

function resetAppState() {
  state.user = null;
  state.membershipId = null;
  state.courses = [];
  state.currentCourse = null;
  state.modules = [];
  state.lessons = [];
  state.enrolled = false;
  state.currentGuide = null;
  document.getElementById('signOutBtn').classList.add('hidden');
}

async function afterLogin(user) {
  state.user = user;
  document.getElementById('signOutBtn').classList.remove('hidden');

  showView('loading');
  setLoadingLine('Finding your membership…');

  // The caller's seafarer membership (architecture §3 — one account, many
  // role memberships). RLS already scopes this to the signed-in account;
  // the explicit account_id filter matches the pattern the server side uses.
  const { data: mem, error: memErr } = await sb
    .from('membership')
    .select('id')
    .eq('account_id', user.id)
    .eq('role', 'seafarer')
    .eq('status', 'active')
    .maybeSingle();

  if (memErr || !mem) {
    showFatal('We could not find your seafarer profile on this account. ' +
      'Make sure you have completed sign-up in the Seaman App, then try again.');
    return;
  }
  state.membershipId = mem.id;

  setLoadingLine('Checking club membership…');
  const { data: isMember, error: clubErr } = await sb.rpc('is_club_member', { p_club: NAV_CLUB_ID });
  if (clubErr) {
    showFatal('Could not verify your club membership right now. Please try again in a moment.');
    return;
  }

  if (!isMember) {
    showView('gate');
    return;
  }

  await loadCourses();
}

function showFatal(message) {
  showView('login');
  const msg = document.getElementById('loginMsg');
  msg.textContent = message;
  msg.classList.remove('hidden');
}

// Google OAuth (redirect flow). Most members sign in with Google. On return,
// supabase-js `detectSessionInUrl` picks up the session automatically.
async function onGoogleSignIn() {
  const btn = document.getElementById('googleBtn');
  const msg = document.getElementById('loginMsg');
  msg.classList.add('hidden');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Opening Google…';
  try {
    // skipBrowserRedirect + manual navigation = explicit control (some
    // installed-PWA/UMD combos don't auto-redirect), and errors surface.
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    if (data && data.url) { window.location.assign(data.url); return; }
    throw new Error('No sign-in URL was returned.');
  } catch (e) {
    msg.textContent = 'Google sign-in failed: ' + (e && e.message ? e.message : e);
    msg.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ── Static (once-per-load) event wiring ────────────────────────────────
function wireStaticHandlers() {
  document.getElementById('loginForm').addEventListener('submit', onLoginSubmit);
  document.getElementById('googleBtn').addEventListener('click', onGoogleSignIn);
  document.getElementById('forgotForm').addEventListener('submit', onForgotSubmit);
  document.getElementById('forgotBtn').addEventListener('click', () => {
    document.getElementById('forgotMsg').classList.add('hidden');
    showView('forgot');
  });
  document.getElementById('backToLoginBtn').addEventListener('click', () => showView('login'));
  document.getElementById('signOutBtn').addEventListener('click', signOut);
  document.getElementById('gateSignOutBtn').addEventListener('click', signOut);
  document.getElementById('courseBackBtn').addEventListener('click', () => {
    stopWatermark();
    showView('courses');
  });
  document.getElementById('lessonBackBtn').addEventListener('click', () => {
    teardownLessonMedia();
    showView('course');
  });

  // Bottom tab bar.
  document.querySelectorAll('#bottomNav .navbtn').forEach((btn) => {
    btn.addEventListener('click', () => openTab(btn.dataset.tab));
  });

  // Field guides.
  document.getElementById('guideBackBtn').addEventListener('click', () => showView('guides'));

  // Leaderboard scope toggle.
  document.querySelectorAll('#lbScopeRow .seg').forEach((btn) => {
    btn.addEventListener('click', () => loadLeaderboard(btn.dataset.scope));
  });

  // Club home shortcuts.
  document.getElementById('clubCoursesBtn').addEventListener('click', () => openTab('courses'));
  document.getElementById('clubGuidesBtn').addEventListener('click', () => openTab('guides'));

  // Install (Android/Chromium beforeinstallprompt, or the iOS instructions).
  document.getElementById('installBtn').addEventListener('click', onInstallClick);
  document.getElementById('iosInstallCloseBtn').addEventListener('click', () => {
    document.getElementById('iosInstallModal').classList.add('hidden');
  });
}

async function onLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginSubmitBtn');
  const msg = document.getElementById('loginMsg');
  msg.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await afterLogin(data.user);
  } catch (err) {
    msg.textContent = err?.message || 'Sign-in failed. Check your email and password.';
    msg.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function onForgotSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('forgotEmail').value.trim();
  const msg = document.getElementById('forgotMsg');
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/app/',
    });
    if (error) throw error;
    msg.textContent = 'If that email has an account, a reset link is on its way.';
    msg.className = 'msg ok';
  } catch (err) {
    msg.textContent = err?.message || 'Could not send the reset email. Try again.';
    msg.className = 'msg err';
  }
  msg.classList.remove('hidden');
}

async function signOut() {
  stopWatermark();
  teardownLessonMedia();
  await sb.auth.signOut();
  resetAppState();
  // The cached feed/leaderboard/club/guide data is tied to whatever account
  // was signed in (guide entitlement, in particular, can differ per member)
  // — clear it on sign-out so the next login never renders someone else's
  // stale offline copy before its own first fetch completes.
  clearDataCache();
  showView('login');
}

// ── Courses ─────────────────────────────────────────────────────────────
async function loadCourses() {
  showView('loading');
  setLoadingLine('Loading your courses…');

  const listEl = document.getElementById('courseList');
  const emptyEl = document.getElementById('coursesEmpty');
  const errEl = document.getElementById('coursesErr');
  listEl.innerHTML = '';
  emptyEl.classList.add('hidden');
  errEl.classList.add('hidden');

  try {
    const { data, error } = await sb.rpc('club_course_catalog', { p_club: NAV_CLUB_ID });
    if (error) throw error;
    state.courses = Array.isArray(data) ? data : [];
  } catch (err) {
    state.courses = [];
    errEl.textContent = 'Could not load courses (' + (err?.message || 'network error') + '). Pull to refresh or try again shortly.';
    errEl.classList.remove('hidden');
  }

  showView('courses');
  renderCourseList();
}

function renderCourseList() {
  const listEl = document.getElementById('courseList');
  const emptyEl = document.getElementById('coursesEmpty');
  listEl.innerHTML = '';
  if (state.courses.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  for (const c of state.courses) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'course-card';
    const coverHtml = c.cover_path
      ? `<img class="course-cover" data-cover="${escapeHtml(c.cover_path)}" alt="" />`
      : `<div class="course-cover fallback">⚓</div>`;
    card.innerHTML = `
      ${coverHtml}
      <div class="course-body">
        <h3>${escapeHtml(c.title)}</h3>
        ${c.subtitle ? `<div class="sub">${escapeHtml(c.subtitle)}</div>` : ''}
        ${c.description ? `<p>${escapeHtml(c.description)}</p>` : ''}
        <div class="course-meta">
          <span>📚 ${c.lessons ?? 0} lesson${(c.lessons ?? 0) === 1 ? '' : 's'}</span>
          <span>▶ ${c.videos ?? 0} video${(c.videos ?? 0) === 1 ? '' : 's'}</span>
        </div>
      </div>`;
    card.addEventListener('click', () => openCourse(c));
    listEl.appendChild(card);

    // Best-effort cover image resolution — never blocks the course list if
    // the bucket/path doesn't resolve (course covers are optional).
    const img = card.querySelector('img[data-cover]');
    if (img) resolveCoverImage(img, c.cover_path);
  }
}

async function resolveCoverImage(imgEl, path) {
  try {
    const { data, error } = await sb.storage.from('user_files').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) throw error || new Error('no url');
    imgEl.src = data.signedUrl;
  } catch (_) {
    // Leave it as a broken/blank img rather than crash the page; swap for
    // the anchor fallback tile.
    imgEl.outerHTML = '<div class="course-cover fallback">⚓</div>';
  }
}

// ── Course detail ───────────────────────────────────────────────────────
async function openCourse(course) {
  state.currentCourse = course;
  showView('loading');
  setLoadingLine('Opening ' + course.title + '…');

  // Auto-enroll (member = consent to enroll, mirrors the app). Non-fatal:
  // free-preview lessons still open even if this fails.
  state.enrolled = false;
  try {
    const { error } = await sb.from('enrollment').upsert(
      { course_id: course.id, member_membership_id: state.membershipId },
      { onConflict: 'course_id,member_membership_id', ignoreDuplicates: true }
    );
    if (!error) state.enrolled = true;
  } catch (_) { /* best-effort */ }

  const [modRes, lesRes] = await Promise.all([
    sb.from('course_module').select('id,title,seq').eq('course_id', course.id).order('seq'),
    sb.from('lesson').select(
      'id,module_id,title,seq,content_type,media_file_id,media_url,body_md,duration_sec,free_preview,stream_uid,stream_status,stream_protect'
    ).eq('course_id', course.id).order('seq'),
  ]);

  state.modules = modRes.data || [];
  state.lessons = lesRes.data || [];

  document.getElementById('courseTitle').textContent = course.title;
  document.getElementById('courseSubtitle').textContent = course.subtitle || '';
  document.getElementById('courseDescription').textContent = course.description || '';

  const noteEl = document.getElementById('enrollNote');
  if (!state.enrolled) {
    noteEl.textContent = 'Only free-preview lessons are open right now — reload if this looks wrong.';
    noteEl.className = 'msg err';
    noteEl.classList.remove('hidden');
  } else {
    noteEl.classList.add('hidden');
  }

  renderModules();
  showView('course');
}

function renderModules() {
  const wrap = document.getElementById('moduleList');
  wrap.innerHTML = '';

  const byModule = new Map();
  for (const l of state.lessons) {
    if (!byModule.has(l.module_id)) byModule.set(l.module_id, []);
    byModule.get(l.module_id).push(l);
  }

  const modules = state.modules.length
    ? state.modules
    : [{ id: null, title: 'Lessons' }]; // fallback if modules didn't load

  for (const mod of modules) {
    const lessons = mod.id ? (byModule.get(mod.id) || []) : state.lessons;
    if (mod.id && lessons.length === 0) continue;

    const block = document.createElement('div');
    block.className = 'module';
    const h4 = document.createElement('h4');
    h4.textContent = mod.title;
    block.appendChild(h4);

    for (const l of lessons) {
      const locked = !state.enrolled && !l.free_preview;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'lesson-row';
      row.innerHTML = `
        <div class="ico${locked ? ' locked' : ''}">${locked ? '🔒' : contentIcon(l.content_type)}</div>
        <div class="txt">
          <b>${escapeHtml(l.title)}</b>
          <small>${l.content_type}${l.duration_sec ? ' · ' + Math.round(l.duration_sec / 60) + ' min' : ''}</small>
        </div>
        <span class="chip ${l.free_preview ? 'free' : 'locked'}">${l.free_preview ? 'Free preview' : (locked ? 'Locked' : '')}</span>
      `;
      row.addEventListener('click', () => openLesson(l));
      block.appendChild(row);
    }
    wrap.appendChild(block);
  }
}

// ── Lesson player ───────────────────────────────────────────────────────
async function openLesson(lesson) {
  teardownLessonMedia();
  document.getElementById('lessonTitle').textContent = lesson.title;
  const body = document.getElementById('lessonBody');
  body.innerHTML = '<div class="center-text" style="padding:40px 0"><div class="spinner"></div></div>';
  showView('lesson');

  if (lesson.content_type === 'markdown') {
    body.innerHTML = `<div class="markdown-body">${renderMarkdown(lesson.body_md)}</div>`;
    return;
  }

  if (lesson.content_type === 'link') {
    const href = lesson.media_url || '';
    body.innerHTML = `
      <div class="doc-card">
        <div class="ico">🔗</div>
        <div>
          <b>External resource</b>
          <p class="player-note" style="margin-top:4px">Opens outside the app.</p>
        </div>
      </div>
      <a class="btn gold block" style="margin-top:14px" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Open resource</a>
    `;
    return;
  }

  if (lesson.content_type === 'video') {
    await renderVideoLesson(lesson, body);
    return;
  }

  // pdf / file
  body.innerHTML = '<div class="center-text" style="padding:30px 0"><div class="spinner"></div><p class="loading-line">Preparing document…</p></div>';
  const url = await resolveMediaUrl(lesson);
  if (!url) {
    body.innerHTML = lockedMessageHtml();
    return;
  }
  body.innerHTML = `
    <div class="doc-card">
      <div class="ico">${contentIcon(lesson.content_type)}</div>
      <div><b>${lesson.content_type === 'pdf' ? 'PDF document' : 'File'}</b></div>
    </div>
    <a class="btn gold block" style="margin-top:14px" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open</a>
  `;
}

function lockedMessageHtml() {
  return `
    <div class="retry-box">
      🔒 This lesson isn't available on your account yet.<br />
      Make sure you're enrolled, or check back after your club status refreshes.
    </div>`;
}

/** Resolve a lesson's playable/openable URL, mirroring the Flutter app's
 * `LmsService.resolveMediaUrl`: a direct media_url wins; otherwise ask the
 * lms-media Edge Function for a short-lived signed R2 URL (cached ~3 min). */
async function resolveMediaUrl(lesson, forceRefresh = false) {
  if (lesson.media_url) return lesson.media_url;
  if (!lesson.media_file_id) return null;

  if (!forceRefresh) {
    const cached = state.mediaUrlCache.get(lesson.id);
    if (cached && cached.exp > Date.now()) return cached.url;
  }

  try {
    const { data, error } = await sb.functions.invoke('lms-media', {
      body: { action: 'get', lesson_id: lesson.id },
    });
    if (error) throw error;
    const url = data?.get_url;
    if (url) {
      state.mediaUrlCache.set(lesson.id, { url, exp: Date.now() + 3 * 60 * 1000 });
    }
    return url || null;
  } catch (_) {
    return null;
  }
}

/** Resolve a playable video source for the web. Prefers Cloudflare Stream
 * (protected adaptive HLS, "require signed URLs") when the lesson has been
 * ingested and is ready; otherwise falls back to the R2 signed URL (the same
 * source the Android app uses). Returns { url, kind } or null. */
async function resolveVideoSource(lesson, forceRefresh = false) {
  // Try Stream only for videos a mentor/admin has PROTECTED (stream_protect)
  // and that have a Stream video — even if still 'pending' (a fresh upload):
  // stream-token lazy-finalizes once Cloudflare reports the encode is done,
  // and returns 409 until then so we fall back to R2. Un-protected videos skip
  // Stream entirely (no cost) and play from R2.
  if (lesson.stream_protect && lesson.stream_uid) {
    const s = await resolveStreamUrl(lesson, forceRefresh);
    if (s) return { url: s, kind: 'stream' };
  }
  const r = await resolveMediaUrl(lesson, forceRefresh);
  if (r) return { url: r, kind: 'r2' };
  return null;
}

/** Ask the stream-token Edge Function for a short-lived signed HLS URL. The
 * function re-checks the same enrol/author/manage boundary as lms-media, then
 * mints a ~2h RS256 token scoped to this one video. Cached until just before
 * expiry. Returns null on 409 (no stream video) / 403 / network — the caller
 * then falls back to R2. */
async function resolveStreamUrl(lesson, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = state.streamUrlCache.get(lesson.id);
    if (cached && cached.exp > Date.now()) return cached.url;
  }
  try {
    const { data, error } = await sb.functions.invoke('stream-token', {
      body: { lesson_id: lesson.id },
    });
    if (error) throw error;
    const url = data?.hls;
    if (!url) return null;
    const exp = (data.exp ? data.exp * 1000 : Date.now() + 2 * 3600 * 1000) - 60000;
    state.streamUrlCache.set(lesson.id, { url, exp });
    return url;
  } catch (_) {
    return null;
  }
}

async function renderVideoLesson(lesson, body) {
  const src = await resolveVideoSource(lesson);
  if (!src) {
    body.innerHTML = lockedMessageHtml();
    return;
  }

  body.innerHTML = `
    <div class="player-wrap" id="playerWrap">
      <video id="lessonVideo" playsinline controls controlslist="nodownload noremoteplayback"
        disablepictureinpicture preload="metadata"></video>
      <div class="watermark" id="watermarkEl"></div>
    </div>
    <p class="player-note">
      For members only — this link is personal and expires automatically. Screen recording is traceable to your account.
    </p>
  `;

  const video = document.getElementById('lessonVideo');
  video.oncontextmenu = () => false;
  video.addEventListener('contextmenu', (e) => e.preventDefault());

  let kind = src.kind;
  let retried = false;

  // A single recovery path for BOTH an expired Stream token (surfaces as an
  // hls.js fatal error) and an expired R2 URL (surfaces as a <video> error):
  // once, re-resolve the source and re-attach; twice, give the user a retry.
  async function recover() {
    if (retried) {
      const wrap = document.getElementById('playerWrap');
      if (wrap) {
        wrap.outerHTML =
          '<div class="retry-box">This lesson\'s video link expired. <button class="linklike" id="retryVideoBtn">Tap to retry</button></div>';
        const retryBtn = document.getElementById('retryVideoBtn');
        if (retryBtn) retryBtn.addEventListener('click', () => openLesson(lesson));
      }
      return;
    }
    retried = true;
    // Refresh the same source kind; if Stream is unavailable this round,
    // resolveVideoSource transparently falls back to R2.
    const fresh = kind === 'stream'
      ? await resolveVideoSource(lesson, true)
      : { url: await resolveMediaUrl(lesson, true), kind: 'r2' };
    if (fresh && fresh.url) { kind = fresh.kind; attachVideoSource(video, fresh.url, recover); }
  }

  attachVideoSource(video, src.url, recover);
  video.addEventListener('error', recover);
  startWatermark(document.getElementById('watermarkEl'));
}

/** Attach a video URL to the <video>, choosing the right playback path:
 *  1. HLS + hls.js supported (desktop Chrome/Firefox, Android web) → hls.js.
 *  2. HLS + native HLS (iOS/macOS Safari — the iOS members) → video.src.
 *  3. progressive mp4 (R2 fallback) → video.src.
 * onFatal fires on an unrecoverable hls.js error (e.g. an expired signed token),
 * which the <video> 'error' event does NOT surface. */
function attachVideoSource(video, url, onFatal) {
  if (video._hls) { try { video._hls.destroy(); } catch (_) {} video._hls = null; }
  const isHls = /\.m3u8($|\?)/i.test(url);
  if (isHls && window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ maxBufferLength: 30 });
    hls.on(window.Hls.Events.ERROR, (_evt, data) => {
      if (data && data.fatal && typeof onFatal === 'function') onFatal();
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    video._hls = hls;
  } else {
    // Native HLS (iOS/macOS Safari) OR progressive mp4 — both play via src.
    video.src = url;
  }
}

function teardownLessonMedia() {
  stopWatermark();
  const video = document.getElementById('lessonVideo');
  if (video) {
    try { video.pause(); } catch (_) {}
    if (video._hls) { try { video._hls.destroy(); } catch (_) {} }
    video.removeAttribute('src');
    video.load();
  }
}

// ── Watermark (deterrence layer — see README "Video protection") ────────
function startWatermark(el) {
  stopWatermark();
  if (!el || !state.user) return;
  const label = (state.user.email || 'member') + ' · ' + new Date().toISOString().slice(0, 10);
  el.textContent = label;
  const reposition = () => {
    const top = 8 + Math.random() * 74;   // % within the video frame
    const left = 6 + Math.random() * 60;  // %
    el.style.top = top + '%';
    el.style.left = left + '%';
  };
  reposition();
  state.watermarkTimer = setInterval(reposition, 14000 + Math.random() * 6000);
}
function stopWatermark() {
  if (state.watermarkTimer) {
    clearInterval(state.watermarkTimer);
    state.watermarkTimer = null;
  }
}

// ── PWA install + service worker ───────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function isStandaloneDisplay() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

function maybeShowInstallBanner() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIos && !isStandaloneDisplay()) {
    const banner = document.getElementById('installBanner');
    if (banner) banner.classList.remove('hidden');
  }
}

// Android/Chromium: the browser fires this when it decides the page is
// installable. We stash the event and swap it for our own "Install app"
// button (the header icon), since the browser's native mini-infobar is easy
// to miss and can't be re-triggered on demand otherwise.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isStandaloneDisplay()) {
    const btn = document.getElementById('installBtn');
    if (btn) btn.classList.remove('hidden');
  }
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById('installBtn');
  if (btn) btn.classList.add('hidden');
  const banner = document.getElementById('installBanner');
  if (banner) banner.classList.add('hidden');
});

/** iOS Safari never fires `beforeinstallprompt`, so on iOS we show the same
 * header button unconditionally (until standalone) and it opens a short
 * "tap Share → Add to Home Screen" instruction sheet instead of a native
 * prompt. On Android/Chromium the button only appears once the browser has
 * actually signalled installability (above) so it's never a dead button. */
function maybeShowInstallButton() {
  if (isStandaloneDisplay()) return;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIos) {
    const btn = document.getElementById('installBtn');
    if (btn) btn.classList.remove('hidden');
  }
}

async function onInstallClick() {
  if (deferredInstallPrompt) {
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      promptEvent.prompt();
      await promptEvent.userChoice;
    } catch (_) { /* user dismissed — fine, nothing to recover */ }
    document.getElementById('installBtn').classList.add('hidden');
    return;
  }
  // No native prompt available (iOS Safari, or Android before the browser
  // has offered one) — show the manual instructions instead of doing nothing.
  document.getElementById('iosInstallModal').classList.remove('hidden');
}

// ── Shared: resolve a `user_files` storage path to a signed URL ─────────
// Every image referenced by guides/feed/leaderboard/club (avatars, cover
// photos, post attachments) lives under user_files/<uid>/community/… and is
// readable by any signed-in user (storage RLS: `user_files_read_community`),
// the same rule the course cover art already relies on. Best-effort: skipped
// entirely while offline so we never burn a retry on a call that can't work,
// and any failure just leaves the initials/placeholder fallback in place.
async function resolveStorageImage(path, { seconds = 3600 } = {}) {
  if (!path || !navigator.onLine) return null;
  try {
    const { data, error } = await sb.storage.from('user_files').createSignedUrl(path, seconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch (_) {
    return null;
  }
}
async function resolveAvatarInto(el, path) {
  const url = await resolveStorageImage(path);
  if (url) { el.style.backgroundImage = `url('${url}')`; el.textContent = ''; }
}
async function resolvePhotoInto(el, path) {
  const url = await resolveStorageImage(path);
  if (url) el.innerHTML = `<img src="${escapeHtml(url)}" alt="" loading="lazy" />`;
}

// ══════════════════════════════════════════════════════════════════════
//  FIELD GUIDES — cloud-delivered markdown (content_manifest/content_download,
//  the same RPCs the Flutter app's Learn tab and lib/features/pro/cloud_content
//  use). Cache-first: the shelf list and every opened guide's body are
//  written to localStorage, so a guide you've already read stays readable
//  with no connection — the app's own "offline-first hero" feature.
// ══════════════════════════════════════════════════════════════════════

const GUIDE_ICONS = {
  policy: '📋', fact_check: '✅', local_gas_station: '⛽', radar: '📡',
  explore: '🧭', layers: '🗺️', gps_fixed: '📍', public: '🌐', checklist: '📝',
};
function guideIcon(name) { return GUIDE_ICONS[name] || '📘'; }

async function loadGuides() {
  const cached = cacheGet('guides:list');
  if (cached) { renderGuideList(cached, false); showView('guides'); }
  else { showView('loading'); setLoadingLine('Loading field guides…'); }

  const errEl = document.getElementById('guidesErr');
  errEl.classList.add('hidden');
  try {
    const { data, error } = await sb.rpc('content_manifest', { p_kind: 'guide' });
    if (error) throw error;
    const items = Array.isArray(data) ? data : [];
    cacheSet('guides:list', items);
    renderGuideList(items, false);
    showView('guides');
  } catch (err) {
    if (cached) {
      renderGuideList(cached, true);
      showView('guides');
    } else {
      document.getElementById('guidesList').innerHTML = '';
      document.getElementById('guidesEmpty').classList.add('hidden');
      errEl.textContent = 'Could not load the guides (' + (err?.message || 'network error') + '). Pull to refresh or try again shortly.';
      errEl.classList.remove('hidden');
      showView('guides');
    }
  }
}

function renderGuideList(items, offline) {
  document.getElementById('guidesOffline').classList.toggle('hidden', !offline);
  const listEl = document.getElementById('guidesList');
  const emptyEl = document.getElementById('guidesEmpty');
  listEl.innerHTML = '';
  if (!items.length) { emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  // Group into shelves by `category` (falls back to one shelf for anything
  // uncategorised), ordered by each shelf's lowest sort_order — mirrors the
  // Learn tab's collapsible-shelf grouping without hardcoding category names,
  // so a new shelf added server-side (e.g. the Engine Room guides) just works.
  const shelves = new Map();
  for (const it of items) {
    const cat = (it.category && String(it.category).trim()) || 'Field Guides';
    if (!shelves.has(cat)) shelves.set(cat, []);
    shelves.get(cat).push(it);
  }
  const ordered = [...shelves.entries()].sort((a, b) => {
    const minA = Math.min(...a[1].map((i) => i.sort_order ?? 0));
    const minB = Math.min(...b[1].map((i) => i.sort_order ?? 0));
    return minA - minB;
  });

  for (const [cat, guides] of ordered) {
    guides.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || `${a.title}`.localeCompare(`${b.title}`));
    const shelf = document.createElement('div');
    shelf.className = 'shelf';
    const h = document.createElement('h4');
    h.textContent = cat;
    shelf.appendChild(h);
    for (const g of guides) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'guide-row';
      row.innerHTML = `
        <div class="ico">${guideIcon(g.icon_name)}</div>
        <div class="txt">
          <b>${escapeHtml(g.title)}</b>
          ${g.blurb ? `<small>${escapeHtml(g.blurb)}</small>` : ''}
        </div>
        ${g.min_tier === 'pro' ? '<span class="chip locked">PRO</span>' : ''}
      `;
      row.addEventListener('click', () => openGuide(g));
      shelf.appendChild(row);
    }
    listEl.appendChild(shelf);
  }
}

async function openGuide(item) {
  state.currentGuide = item;
  document.getElementById('guideTitle').textContent = item.title || 'Guide';
  const body = document.getElementById('guideBody');
  const offlineEl = document.getElementById('guideOffline');
  offlineEl.classList.add('hidden');

  const cacheKey = 'guide:' + item.key;
  const cached = cacheGet(cacheKey);
  if (cached && cached.md) {
    body.innerHTML = renderMarkdown(cached.md);
  } else {
    body.innerHTML = '<div class="center-text" style="padding:40px 0"><div class="spinner"></div></div>';
  }
  showView('guide');

  try {
    const { data, error } = await sb.rpc('content_download', { p_key: item.key });
    if (error) throw error;
    const md = data && data.data && typeof data.data.md === 'string' ? data.data.md : '';
    cacheSet(cacheKey, { md, title: item.title });
    body.innerHTML = md
      ? renderMarkdown(md)
      : '<p class="loading-line">This guide has no content yet.</p>';
  } catch (err) {
    if (cached && cached.md) {
      offlineEl.classList.remove('hidden');
      body.innerHTML = renderMarkdown(cached.md);
    } else {
      body.innerHTML = `
        <div class="retry-box">
          Could not load this guide (${escapeHtml(err?.message || 'network error')}).<br />
          Connect and try again — once you've opened it, it stays readable offline.<br />
          <button class="linklike" id="guideRetryBtn">Retry</button>
        </div>`;
      const retryBtn = document.getElementById('guideRetryBtn');
      if (retryBtn) retryBtn.addEventListener('click', () => openGuide(item));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  COMMUNITY FEED — read-only. Same `post` table + `post_like` votes the
//  Flutter crew feed reads, filtered to already-published posts
//  (publish_at <= now, matching lib/features/community/crew_feed_screen.dart)
//  and scoped by the same RLS (`post_read_visible`) that hides
//  moderator-removed posts from everyone but their author/moderators.
// ══════════════════════════════════════════════════════════════════════

const FEED_PAGE_SIZE = 25;
const FEED_CACHE_KEEP = 20;

async function loadFeed() {
  const cached = cacheGet('feed:posts');
  if (cached) { renderFeed(cached, false); showView('community'); }
  else { showView('loading'); setLoadingLine('Loading the crew feed…'); }

  const errEl = document.getElementById('feedErr');
  errEl.classList.add('hidden');
  try {
    const nowIso = new Date().toISOString();
    const { data: posts, error } = await sb
      .from('post')
      .select('id, membership_id, display_name, author_headline, channel, body, attachment_path, attachment_mime, created_at')
      .lte('publish_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(FEED_PAGE_SIZE);
    if (error) throw error;
    const rows = Array.isArray(posts) ? posts : [];

    const ids = rows.map((p) => p.id);
    const likeCounts = {};
    if (ids.length) {
      try {
        const { data: likes } = await sb.from('post_like').select('post_id, vote').in('post_id', ids);
        for (const l of (likes || [])) {
          if ((l.vote ?? 1) > 0) likeCounts[l.post_id] = (likeCounts[l.post_id] || 0) + 1;
        }
      } catch (_) { /* likes are a nice-to-have; the feed still renders without them */ }
    }

    const memberIds = [...new Set(rows.map((p) => p.membership_id).filter(Boolean))];
    const cardsByMid = {};
    if (memberIds.length) {
      try {
        const { data: cards } = await sb
          .from('public_card')
          .select('membership_id, avatar_path, is_navclub, is_pro')
          .in('membership_id', memberIds);
        for (const c of (cards || [])) cardsByMid[c.membership_id] = c;
      } catch (_) { /* badges/avatars are decoration — never block the feed */ }
    }

    const withExtras = rows.map((p) => ({
      ...p,
      _likes: likeCounts[p.id] || 0,
      _card: cardsByMid[p.membership_id] || null,
    }));
    cacheSet('feed:posts', withExtras.slice(0, FEED_CACHE_KEEP));
    renderFeed(withExtras, false);
    showView('community');
  } catch (err) {
    if (cached) {
      renderFeed(cached, true);
      showView('community');
    } else {
      document.getElementById('feedList').innerHTML = '';
      document.getElementById('feedEmpty').classList.add('hidden');
      errEl.textContent = 'Could not load the crew feed (' + (err?.message || 'network error') + ').';
      errEl.classList.remove('hidden');
      showView('community');
    }
  }
}

function renderFeed(posts, offline) {
  document.getElementById('feedOffline').classList.toggle('hidden', !offline);
  const listEl = document.getElementById('feedList');
  const emptyEl = document.getElementById('feedEmpty');
  listEl.innerHTML = '';
  if (!posts.length) { emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  for (const p of posts) {
    const card = p._card || null;
    const badge = card && card.is_navclub
      ? '<span class="badge navclub" title="Navigators Club member">⚓</span>'
      : (card && card.is_pro ? '<span class="badge pro" title="Seaman Pro">PRO</span>' : '');
    const name = p.display_name || 'A seafarer';
    const initials = name.trim().slice(0, 1).toUpperCase() || '?';
    const headline = p.author_headline ? escapeHtml(prettyRankHeadline(p.author_headline)) : '';
    const dept = p.channel ? escapeHtml(channelLabel(p.channel)) : '';
    const sub = [headline, dept].filter(Boolean).join(' · ');
    const isImage = !p.attachment_mime || String(p.attachment_mime).startsWith('image/');

    const el = document.createElement('div');
    el.className = 'feed-card';
    el.innerHTML = `
      <div class="feed-head">
        <div class="avatar" data-avatar="${card && card.avatar_path ? escapeHtml(card.avatar_path) : ''}">${escapeHtml(initials)}</div>
        <div class="who">
          <div class="name-row"><b>${escapeHtml(name)}</b>${badge}</div>
          ${sub ? `<small>${sub}</small>` : ''}
        </div>
        <span class="time">${timeAgo(p.created_at)}</span>
      </div>
      ${p.body ? `<p class="feed-body">${escapeHtml(p.body)}</p>` : ''}
      ${p.attachment_path && isImage ? `<div class="feed-photo" data-path="${escapeHtml(p.attachment_path)}"><div class="ph-placeholder">📷</div></div>` : ''}
      ${p.attachment_path && !isImage ? `<div class="feed-foot">📎 attachment</div>` : ''}
      <div class="feed-foot"><span>👍 ${p._likes || 0}</span></div>
    `;
    listEl.appendChild(el);

    const avatarEl = el.querySelector('.avatar[data-avatar]');
    if (avatarEl && avatarEl.dataset.avatar) resolveAvatarInto(avatarEl, avatarEl.dataset.avatar);
    const photoEl = el.querySelector('.feed-photo[data-path]');
    if (photoEl) resolvePhotoInto(photoEl, photoEl.dataset.path);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  LEADERBOARD — approximates lib/features/community/leaderboard_screen.dart:
//  every crewmate who has posted, ranked by net votes (likes − dislikes)
//  across their posts this week (Monday reset) or all-time, staff excluded,
//  a public_card (opt-in) layered on top for the flex fields.
// ══════════════════════════════════════════════════════════════════════

function seasonStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function seasonResetLabel() {
  const end = new Date(seasonStart().getTime() + 7 * 86400000);
  const leftMs = end.getTime() - Date.now();
  const days = Math.floor(leftMs / 86400000);
  const hours = Math.floor((leftMs % 86400000) / 3600000);
  if (days > 0) return `Season resets in ${days}d ${hours}h`;
  if (hours > 0) return `Season resets in ${hours}h`;
  return 'Season resets soon';
}

async function loadLeaderboard(scope) {
  state.lbScope = scope;
  document.querySelectorAll('#lbScopeRow .seg').forEach((b) => b.classList.toggle('active', b.dataset.scope === scope));
  document.getElementById('lbResetLabel').textContent = scope === 'week' ? seasonResetLabel() : 'All-time hall of fame';

  const cacheKey = 'leaderboard:' + scope;
  const cached = cacheGet(cacheKey);
  if (cached) { renderLeaderboard(cached, false); showView('leaderboard'); }
  else { showView('loading'); setLoadingLine('Loading the leaderboard…'); }

  const errEl = document.getElementById('lbErr');
  errEl.classList.add('hidden');
  try {
    let staff = new Set();
    try {
      const { data: staffIds } = await sb.rpc('crew_staff_membership_ids');
      staff = new Set((staffIds || []).map((s) => `${s}`));
    } catch (_) { /* fail open, same as the app — a lookup blip must never hide the board */ }

    const { data: posts, error: postsErr } = await sb
      .from('post')
      .select('id, membership_id, display_name, author_headline, channel, created_at');
    if (postsErr) throw postsErr;
    const { data: votes } = await sb.from('post_like').select('post_id, vote');
    const { data: cards } = await sb.from('public_card').select();
    const cardsByMid = {};
    for (const c of (cards || [])) cardsByMid[c.membership_id] = c;

    const since = scope === 'week' ? seasonStart() : null;
    const postOwner = {};
    const byAuthor = {};
    for (const p of (posts || [])) {
      if (since) {
        const at = new Date(p.created_at);
        if (isNaN(at.getTime()) || at < since) continue;
      }
      const mid = `${p.membership_id}`;
      postOwner[p.id] = mid;
      if (!byAuthor[mid]) {
        byAuthor[mid] = {
          membership_id: mid, display_name: p.display_name, headline: p.author_headline,
          _dept: p.channel, _posts: 0, _points: 0,
        };
      }
      byAuthor[mid]._posts += 1;
      if (byAuthor[mid].headline == null) byAuthor[mid].headline = p.author_headline;
      if (byAuthor[mid]._dept == null) byAuthor[mid]._dept = p.channel;
    }
    for (const v of (votes || [])) {
      const owner = postOwner[v.post_id];
      if (!owner || !byAuthor[owner]) continue;
      byAuthor[owner]._points += ((v.vote ?? 1) > 0 ? 1 : -1);
    }

    let ranked = Object.values(byAuthor).map((r) => {
      const card = cardsByMid[r.membership_id];
      const merged = { ...r };
      if (card) {
        // The public card (opt-in) adds the flex, but a null card field must
        // never clobber what the posts already told us (e.g. headline).
        for (const [k, val] of Object.entries(card)) if (val != null) merged[k] = val;
        merged._onDeck = true;
      } else {
        merged._onDeck = false;
      }
      return merged;
    });
    ranked = ranked.filter((r) => !staff.has(r.membership_id));
    ranked.sort((a, b) => (b._points - a._points) || (b._posts - a._posts));
    ranked = ranked.slice(0, 50);

    cacheSet(cacheKey, ranked);
    renderLeaderboard(ranked, false);
    showView('leaderboard');
  } catch (err) {
    if (cached) {
      renderLeaderboard(cached, true);
      showView('leaderboard');
    } else {
      document.getElementById('lbList').innerHTML = '';
      document.getElementById('lbEmpty').classList.add('hidden');
      errEl.textContent = 'Could not load the leaderboard (' + (err?.message || 'network error') + ').';
      errEl.classList.remove('hidden');
      showView('leaderboard');
    }
  }
}

function renderLeaderboard(rows, offline) {
  document.getElementById('lbOffline').classList.toggle('hidden', !offline);
  const listEl = document.getElementById('lbList');
  const emptyEl = document.getElementById('lbEmpty');
  listEl.innerHTML = '';
  if (!rows.length) { emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  rows.forEach((r, i) => {
    const name = r.display_name || 'A seafarer';
    const initials = name.trim().slice(0, 1).toUpperCase() || '?';
    const badge = r.is_navclub
      ? '<span class="badge navclub" title="Navigators Club member">⚓</span>'
      : (r.is_pro ? '<span class="badge pro" title="Seaman Pro">PRO</span>' : '');
    const headline = r.headline ? escapeHtml(prettyRankHeadline(r.headline)) : '';
    const dept = r._dept ? escapeHtml(channelLabel(r._dept)) : '';
    const sub = [headline, dept].filter(Boolean).join(' · ');

    const row = document.createElement('div');
    row.className = 'lb-row' + (i < 3 ? ' top' + (i + 1) : '');
    row.innerHTML = `
      <div class="lb-rank">${i + 1}</div>
      <div class="avatar sm" data-avatar="${r.avatar_path ? escapeHtml(r.avatar_path) : ''}">${escapeHtml(initials)}</div>
      <div class="lb-who">
        <div class="name-row"><b>${escapeHtml(name)}</b>${badge}</div>
        ${sub ? `<small>${sub}</small>` : ''}
      </div>
      <div class="lb-stats">
        <b>${r._points ?? 0}</b>
        <small>${r._posts ?? 0} post${(r._posts ?? 0) === 1 ? '' : 's'}</small>
      </div>
    `;
    listEl.appendChild(row);
    const avatarEl = row.querySelector('.avatar[data-avatar]');
    if (avatarEl && avatarEl.dataset.avatar) resolveAvatarInto(avatarEl, avatarEl.dataset.avatar);
  });
}

// ══════════════════════════════════════════════════════════════════════
//  NAVIGATORS CLUB HOME — a simple landing card (name/tagline/blurb/member
//  count) plus the entry into Courses that already existed. Reads the `club`
//  row directly (readable by any signed-in user — `club_read` policy) with a
//  fallback to just the base name/description columns in case this
//  environment predates the presentation columns (tagline/blurb/cover_path),
//  and best-effort layers on `public_clubs()`'s server-computed counts where
//  that directory RPC is deployed.
// ══════════════════════════════════════════════════════════════════════

async function loadClubHome() {
  const cached = cacheGet('club:home');
  if (cached) { renderClubHome(cached, false); showView('club'); }
  else { showView('loading'); setLoadingLine('Loading the club…'); }

  try {
    const info = { name: 'Navigators Club', tagline: '', blurb: '', memberCount: null, courseCount: null, avgRating: null, reviewCount: null };
    try {
      const { data, error } = await sb
        .from('club')
        .select('name, tagline, blurb, description, cover_path')
        .eq('id', NAV_CLUB_ID)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        info.name = data.name || info.name;
        info.tagline = data.tagline || '';
        info.blurb = data.blurb || data.description || '';
      }
    } catch (_) {
      // The presentation columns (tagline/blurb/cover_path) may not exist in
      // every environment yet — fall back to the columns that always do.
      try {
        const { data } = await sb.from('club').select('name, description').eq('id', NAV_CLUB_ID).maybeSingle();
        if (data) { info.name = data.name || info.name; info.blurb = data.description || ''; }
      } catch (_) { /* keep the static defaults */ }
    }
    try {
      const { data } = await sb.rpc('public_clubs');
      const row = Array.isArray(data) ? data.find((c) => c.id === NAV_CLUB_ID) : null;
      if (row) {
        info.memberCount = row.member_count ?? null;
        info.courseCount = row.course_count ?? null;
        info.avgRating = row.avg_rating ?? null;
        info.reviewCount = row.review_count ?? null;
      }
    } catch (_) { /* directory RPC is a newer, best-effort addition */ }

    cacheSet('club:home', info);
    renderClubHome(info, false);
    showView('club');
  } catch (_) {
    if (cached) {
      renderClubHome(cached, true);
    } else {
      renderClubHome({ name: 'Navigators Club', tagline: '', blurb: '' }, true);
    }
    showView('club');
  }
}

function renderClubHome(info, offline) {
  document.getElementById('clubOffline').classList.toggle('hidden', !offline);
  const stats = [];
  if (info.memberCount != null) stats.push(`${info.memberCount} member${info.memberCount === 1 ? '' : 's'}`);
  if (info.courseCount != null) stats.push(`${info.courseCount} course${info.courseCount === 1 ? '' : 's'}`);
  if (info.avgRating != null) stats.push(`★ ${info.avgRating}${info.reviewCount ? ' · ' + info.reviewCount + ' reviews' : ''}`);

  document.getElementById('clubHero').innerHTML = `
    <div class="center-text">
      <div class="anchor-badge" style="margin:0 auto 16px">⚓</div>
      <span class="eyebrow">Navigators Club</span>
      <h1 class="h">${escapeHtml(info.name || 'Navigators Club')}</h1>
      ${info.tagline ? `<p class="lead" style="color:var(--gold2);font-weight:600;margin-top:2px">${escapeHtml(info.tagline)}</p>` : ''}
      ${info.blurb ? `<p class="lead" style="margin-top:10px">${escapeHtml(info.blurb)}</p>` : ''}
      ${stats.length ? `<div class="club-stats">${stats.map((s) => `<span>${escapeHtml(s)}</span>`).join('')}</div>` : ''}
    </div>
  `;
}

// ── Go ──────────────────────────────────────────────────────────────────
boot().catch((err) => {
  // Last-resort net so a startup failure (e.g. a vendor script that failed
  // to load offline) never leaves a blank white screen.
  console.error('[navclub] boot failed', err);
  showView('login');
  const msg = document.getElementById('loginMsg');
  if (msg) {
    msg.textContent = 'Something went wrong loading the app. Check your connection and refresh.';
    msg.classList.remove('hidden');
  }
});
