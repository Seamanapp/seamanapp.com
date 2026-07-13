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
  mediaUrlCache: new Map(), // lessonId -> { url, exp }
  watermarkTimer: null,
};

// ── View switching ──────────────────────────────────────────────────────
const VIEWS = ['loading', 'login', 'forgot', 'gate', 'courses', 'course', 'lesson'];
function showView(name) {
  for (const v of VIEWS) {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('hidden', v !== name);
  }
  window.scrollTo(0, 0);
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
 * italics, links, unordered lists, paragraphs). Escapes everything first,
 * so a lesson body can never inject a script tag or attribute. Enough for
 * mentor lesson text — not a full CommonMark implementation. */
function renderMarkdown(md) {
  const lines = escapeHtml(md || '').split(/\r?\n/);
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const inline = (t) => t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    let m;
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
  return html;
}

function contentIcon(type) {
  return { video: '▶', pdf: '📄', markdown: '📝', file: '📎', link: '🔗' }[type] || '•';
}

// ── Auth ────────────────────────────────────────────────────────────────
async function boot() {
  registerServiceWorker();
  maybeShowInstallBanner();
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
  const msg = document.getElementById('loginMsg');
  msg.classList.add('hidden');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) {
    msg.textContent = 'Google sign-in failed: ' + error.message;
    msg.classList.remove('hidden');
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
      'id,module_id,title,seq,content_type,media_file_id,media_url,body_md,duration_sec,free_preview'
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

async function renderVideoLesson(lesson, body) {
  const url = await resolveMediaUrl(lesson);
  if (!url) {
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

  attachVideoSource(video, url);

  let retried = false;
  video.addEventListener('error', async () => {
    if (retried) {
      document.getElementById('playerWrap').outerHTML =
        '<div class="retry-box">This lesson\'s video link expired. <button class="linklike" id="retryVideoBtn">Tap to retry</button></div>';
      const retryBtn = document.getElementById('retryVideoBtn');
      if (retryBtn) retryBtn.addEventListener('click', () => openLesson(lesson));
      return;
    }
    retried = true;
    const fresh = await resolveMediaUrl(lesson, true);
    if (fresh) attachVideoSource(video, fresh);
  });

  startWatermark(document.getElementById('watermarkEl'));
}

function attachVideoSource(video, url) {
  const isHls = /\.m3u8($|\?)/i.test(url);
  if (isHls && window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls();
    hls.loadSource(url);
    hls.attachMedia(video);
    video._hls = hls;
  } else {
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

function maybeShowInstallBanner() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (isIos && !isStandalone) {
    const banner = document.getElementById('installBanner');
    if (banner) banner.classList.remove('hidden');
  }
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
