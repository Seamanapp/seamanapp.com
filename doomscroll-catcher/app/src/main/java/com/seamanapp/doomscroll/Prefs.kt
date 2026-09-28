package com.seamanapp.doomscroll

import android.content.Context
import android.content.SharedPreferences
import java.time.LocalDate

/** Feed apps we know about. Package name -> display name. */
object WatchedApps {
    val KNOWN: Map<String, String> = linkedMapOf(
        "com.instagram.android" to "Instagram",
        "com.zhiliaoapp.musically" to "TikTok",
        "com.ss.android.ugc.trill" to "TikTok (Asia)",
        "com.facebook.katana" to "Facebook",
        "com.facebook.lite" to "Facebook Lite",
        "com.google.android.youtube" to "YouTube",
        "com.twitter.android" to "X / Twitter",
        "com.instagram.barcelona" to "Threads",
        "com.reddit.frontpage" to "Reddit",
        "com.snapchat.android" to "Snapchat",
        "com.pinterest" to "Pinterest",
        "com.linkedin.android" to "LinkedIn",
        "com.tumblr" to "Tumblr",
        "com.bereal.ft" to "BeReal",
    )

    fun label(pkg: String): String = KNOWN[pkg] ?: pkg
}

/** Settings + daily stats, all local on the phone. */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.applicationContext.getSharedPreferences("doomscroll", Context.MODE_PRIVATE)

    var limitMinutes: Int
        get() = sp.getInt("limit_minutes", 10)
        set(v) = sp.edit().putInt("limit_minutes", v.coerceIn(1, 120)).apply()

    var snoozeMinutes: Int
        get() = sp.getInt("snooze_minutes", 5)
        set(v) = sp.edit().putInt("snooze_minutes", v.coerceIn(1, 60)).apply()

    var watched: Set<String>
        get() = sp.getStringSet("watched", null)?.toSet() ?: WatchedApps.KNOWN.keys
        set(v) = sp.edit().putStringSet("watched", v.toSet()).apply()

    fun addScrollTime(pkg: String, ms: Long, day: LocalDate = LocalDate.now()) {
        if (ms <= 0) return
        sp.edit()
            .putLong("total_$day", sp.getLong("total_$day", 0) + ms)
            .putLong("app_${day}_$pkg", sp.getLong("app_${day}_$pkg", 0) + ms)
            .apply()
    }

    fun addCatch(day: LocalDate = LocalDate.now()) {
        sp.edit().putInt("catches_$day", catches(day) + 1).apply()
        prune(day)
    }

    fun totalMs(day: LocalDate): Long = sp.getLong("total_$day", 0)

    fun catches(day: LocalDate): Int = sp.getInt("catches_$day", 0)

    /** Per-app scroll time for [day], biggest first. */
    fun perApp(day: LocalDate): List<Pair<String, Long>> {
        val prefix = "app_${day}_"
        return sp.all.mapNotNull { (k, v) ->
            if (k.startsWith(prefix) && v is Long) k.removePrefix(prefix) to v else null
        }.sortedByDescending { it.second }
    }

    /** Drop stats older than two weeks so prefs don't grow forever. */
    private fun prune(today: LocalDate) {
        val cutoff = today.minusDays(14)
        val stale = sp.all.keys.filter { key ->
            val date = when {
                key.startsWith("total_") -> key.removePrefix("total_")
                key.startsWith("catches_") -> key.removePrefix("catches_")
                key.startsWith("app_") -> key.removePrefix("app_").substringBefore('_')
                else -> return@filter false
            }
            runCatching { LocalDate.parse(date).isBefore(cutoff) }.getOrDefault(false)
        }
        if (stale.isNotEmpty()) sp.edit().apply { stale.forEach(::remove) }.apply()
    }
}

fun formatMinutes(ms: Long): String {
    val min = ms / 60_000
    return if (min < 60) "${min}m" else "${min / 60}h ${min % 60}m"
}
