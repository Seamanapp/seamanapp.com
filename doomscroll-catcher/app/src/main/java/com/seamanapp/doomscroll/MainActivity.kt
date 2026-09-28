package com.seamanapp.doomscroll

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** Settings + stats. Built in code to keep the app tiny and dependency-free. */
class MainActivity : Activity() {

    private lateinit var prefs: Prefs
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(32))
        }
        val scroll = ScrollView(this).apply {
            setBackgroundColor(BG)
            addView(content)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // targetSdk 35 draws edge-to-edge; keep content clear of the status/nav bars.
            scroll.setOnApplyWindowInsetsListener { v, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                insets
            }
        }
        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        content.removeAllViews()
        content.addView(label("Doomscroll Catcher", 28f, TEXT, bold = true))
        content.addView(label("Taps you on the shoulder when scrolling stops being a choice.", 15f, MUTED).apply {
            setPadding(0, dp(4), 0, dp(12))
        })
        content.addView(statusCard())
        content.addView(todayCard())
        content.addView(weekCard())
        content.addView(rulesCard())
        content.addView(appsCard())
        content.addView(label("Everything stays on this phone. The app only sees that a feed app scrolled — never what's on screen.", 13f, MUTED).apply {
            setPadding(dp(4), dp(16), dp(4), 0)
        })
    }

    private fun statusCard() = card {
        if (isServiceEnabled()) {
            addView(label("✅  Watching for doomscrolling", 18f, TEXT, bold = true))
            addView(label("You'll be caught after ${prefs.limitMinutes} min of non-stop scrolling.", 14f, MUTED).apply {
                setPadding(0, dp(4), 0, 0)
            })
            addView(button("Test the alert", primary = false) {
                CatcherService.instance?.showDemo()
                    ?: toast("Service is starting — try again in a second")
            })
        } else {
            addView(label("⚠️  Not watching yet", 18f, TEXT, bold = true))
            addView(label(
                "Turn on \"Doomscroll Catcher\" in Accessibility settings. It needs this to notice when a feed app is being scrolled.",
                14f, MUTED,
            ).apply { setPadding(0, dp(4), 0, 0) })
            addView(button("Open Accessibility settings") {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            })
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                addView(label(
                    "Switch greyed out? Android blocks this for sideloaded apps until you allow it: App info → ⋮ menu (top right) → Allow restricted settings. Then try again.",
                    13f, MUTED,
                ).apply { setPadding(0, dp(12), 0, 0) })
                addView(button("Open App info", primary = false) {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                })
            }
        }
    }

    private fun todayCard() = card {
        val today = LocalDate.now()
        addView(label("Today", 13f, MUTED, bold = true))
        addView(label(formatMinutes(prefs.totalMs(today)) + " scrolling", 32f, TEXT, bold = true))
        val caught = prefs.catches(today)
        addView(label(if (caught == 0) "Not caught yet" else "Caught $caught×", 15f, if (caught == 0) GOOD else ACCENT))
        prefs.perApp(today).take(6).forEach { (pkg, ms) ->
            addView(row(WatchedApps.label(pkg), formatMinutes(ms)))
        }
    }

    private fun weekCard() = card {
        addView(label("Last 7 days", 13f, MUTED, bold = true))
        val days = (6 downTo 0).map { LocalDate.now().minusDays(it.toLong()) }
        val max = days.maxOf { prefs.totalMs(it) }.coerceAtLeast(1)
        days.forEach { day ->
            val ms = prefs.totalMs(day)
            val caught = prefs.catches(day)
            addView(LinearLayout(this@MainActivity).apply {
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(6), 0, 0)
                addView(label(day.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault()), 14f, MUTED).apply {
                    gravity = Gravity.START
                }, LinearLayout.LayoutParams(dp(44), LinearLayout.LayoutParams.WRAP_CONTENT))
                val track = LinearLayout(this@MainActivity).apply {
                    val bar = View(this@MainActivity).apply {
                        background = rounded(if (caught > 0) ACCENT else GOOD, 4)
                    }
                    val weight = (ms.toFloat() / max).coerceAtLeast(0.01f)
                    addView(bar, LinearLayout.LayoutParams(0, dp(10), weight))
                    addView(View(this@MainActivity), LinearLayout.LayoutParams(0, dp(10), 1f - weight + 0.0001f))
                }
                addView(track, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                val caughtText = if (caught > 0) " · $caught×" else ""
                addView(label(formatMinutes(ms) + caughtText, 14f, TEXT).apply {
                    gravity = Gravity.END
                }, LinearLayout.LayoutParams(dp(88), LinearLayout.LayoutParams.WRAP_CONTENT))
            })
        }
    }

    private fun rulesCard() = card {
        addView(label("Rules", 13f, MUTED, bold = true))
        addView(stepper("Catch me after", "min of scrolling", prefs.limitMinutes, listOf(1, 5, 10, 15, 20, 30, 45, 60)) {
            prefs.limitMinutes = it
        })
        addView(stepper("Snooze lasts", "min", prefs.snoozeMinutes, listOf(1, 2, 5, 10, 15)) {
            prefs.snoozeMinutes = it
        })
    }

    private fun appsCard() = card {
        addView(label("Apps to watch", 13f, MUTED, bold = true))
        WatchedApps.KNOWN.forEach { (pkg, name) ->
            addView(CheckBox(this@MainActivity).apply {
                text = name
                textSize = 16f
                setTextColor(TEXT)
                buttonTintList = android.content.res.ColorStateList.valueOf(ACCENT)
                isChecked = pkg in prefs.watched
                setOnCheckedChangeListener { _, checked ->
                    prefs.watched = if (checked) prefs.watched + pkg else prefs.watched - pkg
                }
            })
        }
    }

    // --- tiny view helpers ---

    private fun stepper(prefix: String, suffix: String, current: Int, options: List<Int>, onChange: (Int) -> Unit): View {
        val row = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, 0)
        }
        val value = label("", 16f, TEXT)
        var idx = options.indexOfFirst { it >= current }.let { if (it == -1) options.lastIndex else it }
        fun update() {
            value.text = "$prefix ${options[idx]} $suffix"
        }
        update()
        row.addView(value, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also {
            value.gravity = Gravity.START
        })
        row.addView(smallButton("−") {
            if (idx > 0) { idx--; onChange(options[idx]); update() }
        })
        row.addView(smallButton("+") {
            if (idx < options.lastIndex) { idx++; onChange(options[idx]); update() }
        })
        return row
    }

    private fun card(build: LinearLayout.() -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(16), dp(18), dp(16))
        background = rounded(CARD, 18)
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(12) }
        build()
    }

    private fun label(s: String, sizeSp: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = sizeSp
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun row(left: String, right: String) = LinearLayout(this).apply {
        setPadding(0, dp(6), 0, 0)
        addView(label(left, 15f, TEXT), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(label(right, 15f, MUTED))
    }

    private fun button(text: String, primary: Boolean = true, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        textSize = 15f
        setTextColor(if (primary) Color.WHITE else TEXT)
        background = rounded(if (primary) ACCENT else BUTTON, 12)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(48),
        ).apply { topMargin = dp(12) }
    }

    private fun smallButton(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        textSize = 18f
        setTextColor(TEXT)
        background = rounded(BUTTON, 10)
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(dp(44), dp(40)).apply { marginStart = dp(8) }
    }

    private fun rounded(color: Int, radiusDp: Int) = GradientDrawable().apply {
        cornerRadius = dp(radiusDp).toFloat()
        setColor(color)
    }

    private fun dp(v: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics,
    ).toInt()

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun isServiceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?: return false
        val me = ComponentName(this, CatcherService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    private companion object {
        val BG = Color.parseColor("#0F1115")
        val CARD = Color.parseColor("#1A1D23")
        val BUTTON = Color.parseColor("#272B33")
        val TEXT = Color.parseColor("#F2F3F5")
        val MUTED = Color.parseColor("#8B919A")
        val ACCENT = Color.parseColor("#FF5A4E")
        val GOOD = Color.parseColor("#4CC38A")
    }
}
