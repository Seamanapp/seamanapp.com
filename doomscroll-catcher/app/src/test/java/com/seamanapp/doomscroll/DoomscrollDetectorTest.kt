package com.seamanapp.doomscroll

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DoomscrollDetectorTest {
    private val limit = 10 * 60_000L
    private val ig = "com.instagram.android"
    private val tt = "com.zhiliaoapp.musically"

    /** Swipe every [everyMs] from [from] until [until]; returns the last outcome. */
    private fun DoomscrollDetector.swipe(pkg: String, from: Long, until: Long, everyMs: Long) =
        generateSequence(from) { it + everyMs }.takeWhile { it <= until }
            .map { onScroll(pkg, it, limit) }.last()

    @Test
    fun catchesSteadyScrollingPastTheLimit() {
        val d = DoomscrollDetector()
        val before = d.swipe(ig, 0, limit - 10_000, 10_000)!!
        assertFalse(before.caught)
        val at = d.onScroll(ig, limit, limit)!!
        assertTrue(at.caught)
        assertEquals(61, at.swipes)
    }

    @Test
    fun ignoresRepeatEventsFromTheSameSwipe() {
        val d = DoomscrollDetector()
        assertNotNull(d.onScroll(ig, 1_000, limit))
        assertNull(d.onScroll(ig, 1_100, limit))
        assertNull(d.onScroll(ig, 1_500, limit))
        assertNotNull(d.onScroll(ig, 1_700, limit))
    }

    @Test
    fun longPauseStartsANewSession() {
        val d = DoomscrollDetector()
        d.swipe(ig, 0, 8 * 60_000, 10_000)
        val afterBreak = d.onScroll(ig, 8 * 60_000 + 5 * 60_000, limit)!!
        assertEquals(1, afterBreak.swipes)
        assertEquals(0, afterBreak.creditedMs)
        assertFalse(d.swipe(ig, 13 * 60_000 + 10_000, 20 * 60_000, 10_000)!!.caught)
    }

    @Test
    fun appHoppingKeepsTheSessionGoing() {
        val d = DoomscrollDetector()
        d.swipe(ig, 0, 5 * 60_000, 10_000)
        val out = d.swipe(tt, 5 * 60_000 + 10_000, limit, 10_000)!!
        assertTrue(out.caught)
        assertEquals(setOf(ig, tt), out.apps)
    }

    @Test
    fun slowReadingIsNotDoomscrolling() {
        val d = DoomscrollDetector()
        // One swipe every 80s: under the 2/min pace, even after 15 minutes.
        assertFalse(d.swipe(ig, 0, 15 * 60_000, 80_000)!!.caught)
    }

    @Test
    fun snoozeSilencesUntilItEnds() {
        val d = DoomscrollDetector()
        assertTrue(d.swipe(ig, 0, limit, 10_000)!!.caught)
        d.snooze(limit + 5 * 60_000)
        assertFalse(d.onScroll(ig, limit + 60_000, limit)!!.caught)
        assertTrue(d.swipe(ig, limit + 70_000, limit + 5 * 60_000, 10_000)!!.caught)
    }

    @Test
    fun resetForgetsEverything() {
        val d = DoomscrollDetector()
        d.swipe(ig, 0, limit, 10_000)
        d.reset()
        val out = d.onScroll(ig, limit + 1_000, limit)!!
        assertEquals(1, out.swipes)
        assertFalse(out.caught)
    }
}
