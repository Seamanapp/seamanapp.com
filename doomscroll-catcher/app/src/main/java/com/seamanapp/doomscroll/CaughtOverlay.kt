package com.seamanapp.doomscroll

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Full-screen "caught you" card drawn on top of the feed app. Uses an accessibility overlay,
 * so no "draw over other apps" permission is needed.
 */
class CaughtOverlay(
    private val service: AccessibilityService,
    private val sessionMs: Long,
    private val swipes: Int,
    private val apps: List<String>,
    private val catchesToday: Int,
    private val snoozeMinutes: Int,
    private val onGetOut: () -> Unit,
    private val onSnooze: () -> Unit,
) {
    private val wm = service.getSystemService(android.content.Context.WINDOW_SERVICE) as WindowManager
    private val handler = Handler(Looper.getMainLooper())
    private var root: View? = null

    fun show() {
        val view = build()
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )
        wm.addView(view, params)
        root = view
    }

    fun dismiss() {
        handler.removeCallbacksAndMessages(null)
        root?.let { runCatching { wm.removeView(it) } }
        root = null
    }

    private fun build(): View {
        val ctx = service
        fun dp(v: Int) = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics,
        ).toInt()

        fun text(s: String, sizeSp: Float, color: Int, bold: Boolean = false) = TextView(ctx).apply {
            text = s
            textSize = sizeSp
            setTextColor(color)
            gravity = Gravity.CENTER
            if (bold) typeface = Typeface.DEFAULT_BOLD
        }

        val minutes = sessionMs / 60_000
        val where = when (apps.size) {
            0 -> "your feed"
            1 -> apps[0]
            else -> apps.dropLast(1).joinToString(", ") + " and " + apps.last()
        }

        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(28), dp(24), dp(20))
            background = GradientDrawable().apply {
                cornerRadius = dp(24).toFloat()
                setColor(Color.parseColor("#1A1D23"))
            }
            addView(text("🫵", 56f, Color.WHITE))
            addView(text("Caught you doomscrolling.", 24f, Color.WHITE, bold = true).apply {
                setPadding(0, dp(8), 0, dp(8))
            })
            addView(text("$minutes min of non-stop scrolling on $where · $swipes swipes", 16f, Color.parseColor("#C9CDD4")))
            addView(text(NUDGES.random(), 16f, Color.parseColor("#FF8A80")).apply {
                setPadding(0, dp(16), 0, dp(4))
            })
            if (catchesToday > 1) {
                addView(text("Caught $catchesToday times today.", 14f, Color.parseColor("#8B919A")))
            }

            val out = Button(ctx).apply {
                text = "Get me out"
                isAllCaps = false
                textSize = 17f
                setTextColor(Color.WHITE)
                background = GradientDrawable().apply {
                    cornerRadius = dp(14).toFloat()
                    setColor(Color.parseColor("#FF5A4E"))
                }
                setOnClickListener { onGetOut() }
            }
            addView(out, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply {
                topMargin = dp(24)
            })

            // A few seconds of friction before the snooze button works.
            val snooze = Button(ctx).apply {
                isAllCaps = false
                textSize = 15f
                setTextColor(Color.parseColor("#8B919A"))
                setBackgroundColor(Color.TRANSPARENT)
                isEnabled = false
                setOnClickListener { onSnooze() }
            }
            addView(snooze, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply {
                topMargin = dp(8)
            })
            countdown(snooze, 5)
        }

        return FrameLayout(ctx).apply {
            setBackgroundColor(Color.parseColor("#E60B0D10"))
            isClickable = true // swallow touches so the feed underneath can't be scrolled
            addView(card, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            ).apply { setMargins(dp(24), 0, dp(24), 0) })
        }
    }

    private fun countdown(button: Button, secondsLeft: Int) {
        val label = "Just $snoozeMinutes more minutes"
        if (secondsLeft <= 0) {
            button.text = label
            button.isEnabled = true
            return
        }
        button.text = "$label ($secondsLeft)"
        handler.postDelayed({ countdown(button, secondsLeft - 1) }, 1_000)
    }

    private companion object {
        val NUDGES = listOf(
            "Will you remember any of this tomorrow?",
            "The feed never ends. Your evening does.",
            "What were you going to do before you opened this?",
            "Drink some water. Look out a window.",
            "Nothing down there is urgent.",
            "Your thumb deserves a break.",
            "Text a real person instead?",
        )
    }
}
