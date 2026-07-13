# Navigators Club web app (`/app/`)

A standalone, installable PWA so iOS members can watch their **Navigators
Club** courses in the browser, until the native Seaman App ships on iOS.
Served at `seamanapp.com/app/`. Plain HTML/CSS/JS, no build step, no runtime
CDN calls — everything it needs is vendored and committed.

This is a **separate concern from the Flutter app** — it talks to the same
prod Supabase project (`iegxzjflqqoxxarfomnv`) over the public anon key, and
every access rule is enforced by the same Postgres RLS/RPCs the Flutter app
already relies on. Nothing here bypasses that boundary.

## File layout

```
app/
  index.html            all views (login / forgot / gate / courses / course / lesson)
  style.css              deep-ocean/gold theme, matches ../assets/style.css tokens
  app.js                 all app logic (auth, data, player, watermark, SW registration)
  manifest.webmanifest   PWA manifest (name, icons, standalone display)
  sw.js                  service worker — shell-only cache, see below
  icons/
    icon-192.png         generated from ../assets/shots/app-icon.png
    icon-512.png
  vendor/
    supabase.js          @supabase/supabase-js v2, UMD build (pinned via jsdelivr, committed)
    hls.min.js            hls.js v1, UMD build (pinned via jsdelivr, committed)
  README.md              this file
```

No bundler, no `node_modules`, no `package.json`. GitHub Pages serves the
files as-is.

## The flow: auth → membership gate → courses → protected player

1. **Login** (`view-login`) — email/password via
   `supabase.auth.signInWithPassword`, the *same account* as the Flutter
   app (Supabase Auth is shared). "Forgot your password?" uses
   `resetPasswordForEmail`. Session persists (`persistSession: true`) so a
   reload / relaunch from the Home Screen icon stays signed in.

2. **Resolve membership** — after sign-in, the app reads the caller's
   `seafarer` `membership` row (`account.id = auth.uid()`, RLS-scoped so a
   user can only ever see their own row regardless of the filter).

3. **Membership gate** (`view-gate`) — calls the `is_club_member(p_club)`
   RPC with the Navigators Club id
   (`22222222-2222-2222-2222-222222222201`, the same well-known constant
   `kNavClubUuid` the Flutter app uses). Not a member → a friendly "this is
   a Navigators Club perk" screen with a link to `seamanapp.com/#join` and
   a sign-out button. **No course data of any kind loads for a non-member**
   — the block happens before the first course query, and would be refused
   by RLS even if the client tried anyway.

4. **Courses** (`view-courses`) — `club_course_catalog(p_club)` RPC
   (SECURITY DEFINER, returns title/subtitle/description/cover/lesson+video
   counts past the member-only course RLS). Tapping a course:
   - **auto-enrolls** the member (`enrollment` upsert on
     `(course_id, member_membership_id)`, non-fatal if it fails — a
     `free_preview` lesson still opens), then
   - loads `course_module` + `lesson` for that course (both gated by the
     same `can_see_course()` RLS the Flutter app uses, so a non-member
     sees nothing even if they guessed a course id).

5. **Course detail** (`view-course`) — modules with their lessons, an icon
   per `content_type` (video/pdf/markdown/file/link), a lock icon + chip
   on anything that isn't `free_preview` while the auto-enroll hasn't
   confirmed yet.

6. **Lesson player** (`view-lesson`):
   - `markdown` → rendered client-side (a small, escape-first Markdown
     subset: headings, bold/italic, links, lists — safe by construction,
     no `innerHTML` of untrusted raw text).
   - `link` → an "Open resource" button (`target=_blank`).
   - `pdf` / `file` → resolves a signed URL the same way video does, then
     an "Open" button.
   - `video` → see below.

   Media resolution mirrors the Flutter app's `LmsService.resolveMediaUrl`
   exactly: a lesson's `media_url` (external/demo clip) is used directly;
   otherwise the app calls the **`lms-media` Edge Function**
   (`action: 'get', lesson_id`) with the user's JWT, which re-checks
   enrolment/free-preview/authorship **server-side** and returns a
   short-lived signed R2 URL (cached client-side ~3 minutes, same TTL the
   app uses). A refused/expired lesson gets a clear message, not a broken
   player.

7. **Sign out** — top-bar button, clears the Supabase session; the
   `onAuthStateChange` listener resets all in-memory app state.

## Video protection (v1 — deterrence, honestly labelled)

This slice does **not** re-encode anything — it layers protection on top of
the existing signed-MP4-URL pipeline:

- **Short-lived signed URLs.** The player never sees a durable link — only
  a presigned R2 GET URL good for a few minutes, fetched fresh per lesson
  open and re-fetched once on playback error.
- **`controlsList="nodownload noremoteplayback"` + `disablePictureInPicture`**
  on the `<video>` element, and the context menu is suppressed
  (`oncontextmenu`) so the browser's own "Save video" / cast affordances
  are hidden where the browser honours them.
- **A moving, per-user watermark.** A semi-transparent overlay
  (`<div class="watermark">`) showing the signed-in member's **email +
  date**, repositioned to a new random spot inside the video frame every
  ~14–20 seconds. It sits in a separate absolutely-positioned layer over
  the `<video>` (not burned into the stream), so any screen recording or
  photograph of the screen carries a visible, moving trace back to the
  account that watched it.
- `playsinline` so iOS Safari plays the video in the page instead of
  auto-fullscreen (needed for the watermark overlay to stay visible, and
  for a normal in-app feel).

**Honest limits, stated plainly (per the brief):** none of this stops a
determined screen recording — it deters casual leaking and makes any leak
traceable, nothing more. `controlsList` is a *hint* Chromium mostly
honours and Safari/WebKit does **not**; iOS's native player affordances
(AirPlay, share sheet) aren't fully suppressible from a `<video>` element.

### The stronger follow-up (documented, NOT built in this slice)

**Encrypted HLS.** Transcode each course video once to HLS with AES-128
segment encryption, and serve the decryption key only from an
auth-gated endpoint (e.g. a small Edge Function that checks the same
enrolment rule before handing out the key, with a short TTL and possibly
per-session key rotation). `hls.js` is already vendored
(`vendor/hls.min.js`) specifically so this is a drop-in follow-up:
`attachVideoSource()` in `app.js` already branches on `.m3u8` URLs and
will pick it up automatically once the media pipeline produces them. This
needs an actual transcoding step (ffmpeg, run once per video, likely as a
small pipeline job) and is real, scoped work — deliberately **not** done
here so it isn't forgotten, but also isn't half-built.

## The bottom tab bar: Courses / Guides / Community / Leaderboard / Club

Once signed in and past the membership gate, the app is a 5-tab shell
(`#bottomNav`, fixed to the bottom of the viewport). `showView()` still
drives every screen exactly as before; `updateChrome()` additionally shows
the tab bar only on the five top-level tab views (`courses`, `guides`,
`community`, `leaderboard`, `club`) and hides it on every drill-down screen
(login/gate/course-detail/lesson/guide-reader), which keep their own back
button — the same pattern the original app already used for course → lesson.
`openTab(name)` is the single entry point each tab button calls.

- **Courses** — unchanged from the original slice (see above).
- **Guides** — `content_manifest({p_kind:'guide'})` / `content_download` RPCs,
  the same cloud-content pipeline `lib/features/pro/cloud_content.dart` and
  the Learn tab's e-book reader use. Guides are grouped into shelves by their
  `category` field (whatever shelves exist server-side — nothing hardcoded),
  each shelf ordered by its lowest `sort_order`. Opening a guide renders its
  markdown body (`data.md`) through a small escape-first renderer (the
  original lesson-markdown renderer, extended with blockquotes/`<hr>`/inline
  `code` — no new vendored library).
- **Community** — read-only feed: the last 25 published posts
  (`publish_at <= now`, matching the app's own filter) with per-post like
  counts (`post_like`, `vote > 0`) and, best-effort, the poster's avatar +
  Navigators Club / Pro badge from their opt-in `public_card`. No composing,
  liking, or reporting in this slice — RLS (`post_read_visible`) already
  keeps moderator-hidden posts out of the read.
- **Leaderboard** — a client-side re-implementation of
  `lib/features/community/leaderboard_screen.dart`'s algorithm: every member
  who has posted, ranked by net votes (likes − dislikes) on their posts, This
  week (Monday reset) or All-time, staff membership ids excluded
  (`crew_staff_membership_ids()`, fails open to an empty set exactly like the
  app), `public_card` layered on top for the avatar/badges without ever
  letting a null card field clobber a value already known from the post.
- **Club** — a small landing card for the Navigators Club: reads the `club`
  row directly (`club_read` policy — any signed-in user), with a fallback to
  just `name`/`description` if the newer presentation columns
  (`tagline`/`blurb`/`cover_path`) aren't deployed in a given environment, and
  best-effort layers on `public_clubs()`'s server-computed member/course
  counts + rating where that directory RPC exists. "View courses" jumps to
  the Courses tab; nothing here duplicates data that tab already owns.

All five tabs are still gated behind the same membership check as Courses —
sign-in → seafarer membership → `is_club_member()` → the tab shell. Field
Guides / Community / Leaderboard are conceptually open to any signed-in
seafarer in the Flutter app (not Navigators-Club-specific), but this PWA is
explicitly the *Navigators Club* web app, so they're offered here as
additional club perks rather than reworking the entry gate.

## Offline data caching (what actually makes "opening offline" work)

The service worker (`sw.js`) only ever caches the app **shell**
(html/css/js/vendor/icons — see below); it deliberately never touches a
Supabase call. That was true before this change and still is. What's new is
a small **data** cache layered on top, in `app.js`, using `localStorage`
(namespaced under the `ncw:1:` prefix so a future cache-shape change can bump
the version without colliding with old entries):

- `cacheGet(key)` / `cacheSet(key, value)` — JSON-serialise to/from
  `localStorage`, wrapped in `try/catch` so a full or unavailable store
  (e.g. Safari private browsing) degrades to "no offline copy" rather than
  crashing the page.
- Every tab loader (`loadGuides`, `loadFeed`, `loadLeaderboard`,
  `loadClubHome`) and the guide reader (`openGuide`) follow the same
  **cache-first, then refresh** shape:
  1. If a cached copy exists, render it **immediately** (no spinner) and
     switch to that view.
  2. Fetch fresh data in the background (RPC/table calls, or bundled
     into the same call if there was no cache yet — in that case a spinner
     shows for this first, cold load only).
  3. On success: overwrite the cache and re-render with the fresh copy
     (silently — no "updated" flash).
  4. On failure (offline, or the request throws): if a cached copy exists,
     keep showing it and surface a small **"📡 Offline — showing your saved
     copy"** note (`.offline-note`, one per view); if there was never a
     cached copy, show a plain error/retry state instead of a blank screen.
- What's cached: the guide **shelf list** (`guides:list`) and every guide's
  **markdown body** once opened (`guide:<key>`) — deliberately the guides'
  hero feature, since they're the app's "offline-first" reference material;
  the last 20 **feed posts** (`feed:posts`, mirroring the Flutter app's own
  20-post offline cache); the computed **leaderboard** per scope
  (`leaderboard:week` / `leaderboard:all`); and the **club home** summary
  (`club:home`). Course lists/lessons were already cache-adjacent via the
  existing flow and are unchanged in this slice.
- What's **not** cached, on purpose: signed avatar/photo/video URLs (they
  expire in ~1 hour, so caching them offline would just show a broken image
  or a dead video link) and anything from the `lms-media` Edge Function.
  `resolveStorageImage()` skips the network call entirely when
  `navigator.onLine` is false, so an offline feed/leaderboard render shows
  initials instead of silently retrying a call that can't succeed.
- The data cache is cleared on sign-out (`clearDataCache()`) — guide
  entitlement and feed/leaderboard contents are tied to whoever is signed
  in, so a fresh login should never render a flash of the previous account's
  offline copy before its own first fetch lands.

`sw.js`'s `CACHE_NAME` was bumped `v3` → `v4` purely so every existing
installed PWA picks up this shell update (new views/markup/script) on next
launch; its actual caching logic (shell-only, same-origin, exact
`SHELL_FILES` list) is unchanged — no new files were added to that list
because everything above lives inside the existing `app.js`/`index.html`/
`style.css`.

## Install button (Android/Chromium + iOS)

A single header icon (`#installBtn`, next to sign-out) now offers install on
both platforms, in addition to the existing passive `#installBanner` on the
Courses tab:

- **Android/Chromium** — `window.addEventListener('beforeinstallprompt', …)`
  captures and `preventDefault()`s the browser's native prompt, stashes the
  event, and reveals `#installBtn`. Tapping it calls the saved event's
  `.prompt()` and awaits `.userChoice`; the button hides itself afterward
  (installed or dismissed — either way the deferred prompt is spent and a
  fresh one won't fire again immediately). `appinstalled` also hides the
  button (and the passive banner) in case the browser's own UI was used
  instead.
- **iOS Safari** — there is no `beforeinstallprompt`. `#installBtn` is shown
  unconditionally (once, on boot, via `maybeShowInstallButton()`) whenever
  the user agent looks like iOS and the app isn't already running standalone
  (`navigator.standalone` / `display-mode: standalone`). Tapping it — since
  there's no `deferredInstallPrompt` to call — opens `#iosInstallModal`, a
  short bottom-sheet with the "tap Share → Add to Home Screen → Add" steps
  (the existing `#installBanner` still shows the same hint passively on the
  Courses tab, unchanged from before).
- Either way, the button is hidden once the display mode is already
  `standalone` (checked at boot and on `appinstalled`) — it never shows to
  someone who already installed.

## PWA / install setup

- `manifest.webmanifest` — `display: standalone`, `start_url`/`scope`
  `/app/`, theme/background `#04101f` (matches the site), 192/512 icons
  generated from the existing `assets/shots/app-icon.png`.
- iOS ignores the manifest for icon/standalone purposes, so `index.html`
  also carries the classic meta tags: `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`,
  and an explicit `<link rel="apple-touch-icon">`.
- Because iOS Safari has no `beforeinstallprompt` event, the app shows a
  simple **"Add to Home Screen" hint banner** (`#installBanner`) on iOS
  when it detects it is *not* already running standalone
  (`navigator.standalone` / `display-mode: standalone` media query).
- `sw.js` registers on load and precaches exactly the shell files listed
  in `SHELL_FILES` (html/css/js/vendor/icons/manifest). Its fetch handler
  only ever intercepts requests that are **same-origin, under `/app/`,
  and literally in that precache list** — every Supabase auth/REST/RPC
  call, every `lms-media` Edge Function call, and every signed R2 video
  URL is left completely untouched (never cached, always fetched live).
  That means: the installed app can always *open* offline (you'll land on
  the login screen or last-known view), but course data and video
  playback correctly require a connection — there is no offline video
  cache, by design (a cached signed URL would go stale, and caching
  course video to disk is exactly what "no download" is meant to
  prevent).

## What's vendored, and why no CDN at runtime

- `vendor/supabase.js` — `@supabase/supabase-js@2` UMD build, pulled once
  from jsdelivr and committed (`window.supabase.createClient(...)`).
- `vendor/hls.min.js` — `hls.js@1` UMD build, committed the same way.
  Not actively used for playback today (lessons are plain MP4 via signed
  URL), included now so the encrypted-HLS follow-up above is a drop-in,
  and so the installed PWA never needs a CDN even if a course does get an
  `.m3u8` source later.

Both are plain `<script src="vendor/...">` tags — no import maps, no
bundler, no build step. The Supabase anon/publishable key embedded in
`app.js` is the **public** key (safe client-side by design); it grants
nothing the RLS policies and RPCs on the server don't independently allow.

## What was NOT touched

Nothing outside `app/` changed except **one line**: a "Navigators Club
(web)" link was added to the footer of `index.html` (kept ordinary and
easy to remove — see the diff). `privacy.html`, `terms.html`,
`guidelines.html`, `delete-account.html`, `CNAME`, `.well-known/`,
`404.html`, `join/`, `vouch/`, `assets/` are all unchanged.

## What could NOT be verified without a real login

I don't have a real Navigators Club member's credentials, so the following
are wired correctly by code inspection and match the Flutter app's exact
queries/RPCs/Edge Function contract, but were **not exercised end-to-end
against live data**:

- A real `signInWithPassword` round-trip against prod.
- Whether `is_club_member` actually returns `true` for a real member
  account (logic verified against the migration; the RPC itself is already
  live and used by the Flutter app).
- `club_course_catalog` actually returning rows (same RPC the Flutter app
  already calls in prod per the build log — "verified prod returns 4
  courses" — reused as-is here).
- The `lms-media` Edge Function returning a working signed URL and actual
  video playback in an iOS Safari / installed-PWA context (Safari's video
  + autoplay/inline quirks are the one thing that most needs a real
  on-device check).
- Course **cover image** rendering — it best-effort resolves
  `cover_path` via a signed URL from the `user_files` bucket
  (`community` subfolder, same as the Flutter app's `setCourseCover`) and
  falls back to a plain anchor tile on any error, but wasn't checked
  against a course that actually has a cover set.
- The real "Add to Home Screen" → standalone launch → offline shell load
  → sign back in flow on an actual iPhone.
- `content_manifest`/`content_download` actually returning guide rows for a
  real member (RPC contract verified against the migrations + the Flutter
  Learn tab's identical usage; the RPCs are confirmed live on prod, but a
  real fetch/render of a real guide's markdown wasn't exercised).
- The community feed / leaderboard queries against real `post` /
  `post_like` / `public_card` rows — the queries mirror
  `crew_feed_screen.dart` / `leaderboard_screen.dart` exactly (same tables,
  columns, and ranking arithmetic), but weren't run against live data.
- `crew_staff_membership_ids()` and `public_clubs()` — both are wrapped in
  `try/catch` with a graceful fallback (empty staff set; a plain club card
  with no counts) specifically because it wasn't possible to confirm both
  are deployed to prod at the time of writing (some of the `club`
  presentation columns and the clubs-directory RPC come from migrations
  whose own comments say "DEV only" for a *sibling* migration in the same
  batch) — worth an owner check.
- The Android `beforeinstallprompt` → `#installBtn` → native install-prompt
  round trip, and the iOS instructions modal, on real devices/browsers.
- The `localStorage` offline cache actually surviving a real Airplane Mode
  test for Guides/Community/Leaderboard/Club (logic + fallbacks verified by
  inspection and a Node syntax check; not exercised in a real browser).

What **was** verified without a login: the page structure loads and
initializes the Supabase client without throwing (by inspection — all
Supabase calls are guarded), `app.js`/`sw.js` pass `node --check`, the
service worker's precache list matches real files on disk, every static
view/element id referenced in `app.js` exists in `index.html` (checked
programmatically), every `<div>`/`<section>` tag is balanced, and every new
helper function referenced in `app.js` has exactly one matching declaration.

## Owner test checklist (needs a real device + a real member account)

1. Visit `https://seamanapp.com/app/` on an iPhone in Safari.
2. Sign in with a Navigators Club member's Seaman App credentials.
3. Confirm the course list loads, open a course, confirm lessons render
   grouped by module with the right lock/free-preview state.
4. Open a video lesson: confirm it plays inline, confirm the watermark
   (your email + today's date) appears and drifts to a new spot every
   ~15s, try long-press / share-sheet to confirm there's no easy "Save
   Video" surfaced.
5. Tap Safari's Share → "Add to Home Screen", relaunch from the icon,
   confirm it opens full-screen (no Safari chrome) and the "Add to Home
   Screen" hint banner is gone once standalone.
6. Turn on Airplane Mode, relaunch the installed icon: confirm the shell
   (login screen) still appears instead of a blank/broken page; turn Wi-Fi
   back on and sign in normally.
7. Sign in with a non-member account: confirm the membership-gate screen
   appears instead of any course data.
8. Switch through the new bottom tabs (Guides / Community / Leaderboard /
   Club); confirm each loads real data (or a clear empty/error state, not a
   blank screen).
9. Open a field guide, confirm it renders; go back, turn on Airplane Mode,
   reopen the SAME guide from the shelf list: confirm it still renders (from
   the local cache) with the "📡 Offline — showing your saved copy" note.
   Try a guide you've never opened while offline: confirm it shows a clear
   "connect and try again" message, not a blank page.
10. With Airplane Mode still on, switch to Community and Leaderboard:
    confirm each shows its last-loaded copy with the offline note (assuming
    you visited them at least once while online this session/device).
11. On Android/Chromium (e.g. desktop Chrome or an Android phone), confirm
    the header's install icon appears once the browser considers the page
    installable, and tapping it opens the real install prompt. On iOS,
    confirm the same icon opens the "Add to Home Screen" instructions.
12. Confirm the header install icon disappears once the app is actually
    installed/running standalone.
