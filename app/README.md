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

What **was** verified without a login (see below): the page structure
loads and initializes the Supabase client without throwing, the service
worker registers and its precache list matches real files on disk, and
every view/element id referenced in `app.js` exists in `index.html`.

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
