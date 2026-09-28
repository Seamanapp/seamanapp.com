package com.seamanapp.doomscroll

/**
 * Pure, Android-free logic that decides when scrolling has turned into doomscrolling.
 *
 * A "session" is a run of swipes in any watched app where no two swipes are more than
 * [idleGapMs] apart. Hopping from Instagram to TikTok keeps the session alive; putting the
 * phone down (or reading one thing for a while) ends it.
 *
 * You get caught when a session has lasted at least the limit AND you've kept swiping at a
 * doomscroll-ish pace (at least [minSwipesPerMinute] on average), and you're not snoozed.
 */
class DoomscrollDetector(
    private val idleGapMs: Long = 90_000,
    private val minSwipeGapMs: Long = 600,
    private val minSwipesPerMinute: Int = 2,
) {
    data class Outcome(
        /** Time since the previous swipe, to be credited to [pkg] in the stats (0 on a new session). */
        val creditedMs: Long,
        val pkg: String,
        val caught: Boolean,
        val sessionMs: Long,
        val swipes: Int,
        val apps: Set<String>,
    )

    private var sessionStart = 0L
    private var lastSwipe: Long? = null
    private var swipes = 0
    private var snoozeUntil = 0L
    private val apps = linkedSetOf<String>()

    /**
     * Feed a scroll event from a watched app. Returns null when the event is just part of the
     * same swipe (scroll events fire many times per gesture).
     */
    fun onScroll(pkg: String, now: Long, limitMs: Long): Outcome? {
        val last = lastSwipe
        val gap = if (last == null) -1L else now - last
        if (gap in 0 until minSwipeGapMs) return null

        val credited: Long
        if (gap < 0 || gap > idleGapMs) {
            sessionStart = now
            swipes = 0
            snoozeUntil = 0L
            apps.clear()
            credited = 0L
        } else {
            credited = gap
        }
        swipes++
        lastSwipe = now
        apps += pkg

        val sessionMs = now - sessionStart
        val minutes = sessionMs / 60_000.0
        val caught = sessionMs >= limitMs &&
            swipes >= minutes * minSwipesPerMinute &&
            now >= snoozeUntil
        return Outcome(credited, pkg, caught, sessionMs, swipes, apps.toSet())
    }

    /** "Just N more minutes": keep the session going but stay quiet until [until]. */
    fun snooze(until: Long) {
        snoozeUntil = until
    }

    /** Screen went off, or the user bailed out: start fresh next time. */
    fun reset() {
        sessionStart = 0L
        lastSwipe = null
        swipes = 0
        snoozeUntil = 0L
        apps.clear()
    }
}
