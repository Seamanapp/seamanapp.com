package com.seamanapp.doomscroll

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.accessibility.AccessibilityEvent

/**
 * Listens for scroll events in feed apps. Only the event type and the app's package name are
 * used; no screen content is read, and nothing leaves the phone.
 */
class CatcherService : AccessibilityService() {

    private val detector = DoomscrollDetector()
    private lateinit var prefs: Prefs
    private var overlay: CaughtOverlay? = null

    private val screenOff = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            detector.reset()
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        prefs = Prefs(this)
        val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenOff, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(screenOff, filter)
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_VIEW_SCROLLED) return
        if (overlay != null) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg !in prefs.watched) return

        val now = SystemClock.elapsedRealtime()
        val outcome = detector.onScroll(pkg, now, prefs.limitMinutes * 60_000L) ?: return
        prefs.addScrollTime(pkg, outcome.creditedMs)
        if (outcome.caught) {
            prefs.addCatch()
            showCaught(outcome.sessionMs, outcome.swipes, outcome.apps)
        }
    }

    fun showCaught(sessionMs: Long, swipes: Int, apps: Set<String>) {
        if (overlay != null) return
        buzz()
        overlay = CaughtOverlay(
            service = this,
            sessionMs = sessionMs,
            swipes = swipes,
            apps = apps.map(WatchedApps::label),
            catchesToday = prefs.catches(java.time.LocalDate.now()),
            snoozeMinutes = prefs.snoozeMinutes,
            onGetOut = {
                dismissOverlay()
                detector.reset()
                performGlobalAction(GLOBAL_ACTION_HOME)
            },
            onSnooze = {
                dismissOverlay()
                detector.snooze(SystemClock.elapsedRealtime() + prefs.snoozeMinutes * 60_000L)
            },
        ).also { it.show() }
    }

    /** Called from the app's "Test the alert" button. */
    fun showDemo() = showCaught(prefs.limitMinutes * 60_000L, prefs.limitMinutes * 9, setOf("com.instagram.android"))

    private fun dismissOverlay() {
        overlay?.dismiss()
        overlay = null
    }

    private fun buzz() {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(VIBRATOR_SERVICE) as Vibrator
        }
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 120, 80, 120), -1))
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        dismissOverlay()
        runCatching { unregisterReceiver(screenOff) }
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        /** Set while the service is running, so the settings screen can trigger a test alert. */
        @Volatile
        var instance: CatcherService? = null
            private set
    }
}
