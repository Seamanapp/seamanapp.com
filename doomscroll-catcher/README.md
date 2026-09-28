# Doomscroll Catcher (Android)

A tiny Android app that catches you doomscrolling. When you've been swiping through
Instagram, TikTok, YouTube Shorts, Facebook, X, Reddit etc. non-stop for too long, it
buzzes and throws a full-screen **"Caught you doomscrolling."** card over the feed:

- **Get me out**: sends you to the home screen and resets the timer.
- **Just 5 more minutes**: unlocks after a 5-second countdown, then leaves you alone
  for the snooze period. Keep going past it and you get caught again.

The main screen shows today's scroll time per app, how many times you got caught, and
a 7-day chart. You choose the time limit, the snooze length and which apps to watch.

## How it decides you're doomscrolling

An accessibility service listens for *scroll events only* (no screen content is read, and
`canRetrieveWindowContent` is off). You're caught when **all** of these are true:

1. You've been scrolling in watched apps for at least the limit (default **10 min**).
   Switching from one watched app to another keeps the clock running.
2. There hasn't been a break of more than **90 seconds** without a swipe. A longer break,
   or turning the screen off, resets the clock.
3. You averaged at least **2 swipes a minute**, so slowly reading one long post doesn't count.
4. You're not in a snooze.

The logic lives in `DoomscrollDetector.kt` and is unit-tested.

## Get the APK

Every push that touches `doomscroll-catcher/` runs the **Doomscroll Catcher APK** GitHub
Action. Open the run and download the `doomscroll-catcher-apk` artifact, then unzip it
to get `app-release.apk`. You can also start a build by hand from the Actions tab with
**Run workflow**.

Or build it locally with JDK 17 and the Android SDK:

```sh
cd doomscroll-catcher
./gradlew assembleRelease   # -> app/build/outputs/apk/release/app-release.apk
```

## Install and turn it on

1. Copy the APK to your phone and open it. Allow "install unknown apps" if you're asked.
2. Open **Doomscroll Catcher** and tap **Open Accessibility settings**. Choose
   **Doomscroll Catcher** and switch it on.
3. **Android 13+:** if the switch is greyed out ("Restricted setting"), go back to the
   app and tap **Open App info**. Tap the **⋮** menu in the top-right corner and choose
   **Allow restricted settings**, then repeat step 2.
4. Tap **Test the alert** to see what getting caught looks like.

Some phones (Xiaomi, Oppo, Samsung with aggressive battery saving) kill accessibility
services. If it stops catching you, set the app's battery usage to **Unrestricted**.

## Privacy

Everything stays on the phone. The app has no internet permission; the only permission
it declares is vibration. Stats are kept for 14 days in local app storage.
