# seamanapp.com

Marketing + legal site for **Seaman App**, served by GitHub Pages on the custom
domain `seamanapp.com`.

- `index.html` — landing page
- `privacy.html` — privacy policy (RA 10173)
- `delete-account.html` — account/data deletion instructions (Google Play requirement)
- `budget/` — private family get-out-of-debt budget (irregular business income); data stays in the browser, no pixel.
  `budget/android/build.sh` wraps it as an offline Android APK (WebView, no Gradle)
- `CNAME` — custom-domain binding for GitHub Pages

Static HTML/CSS only — no build step. Push to `main` and GitHub Pages deploys.
