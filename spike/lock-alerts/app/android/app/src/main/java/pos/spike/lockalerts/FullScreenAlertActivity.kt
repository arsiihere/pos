package pos.spike.lockalerts

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView

/** [spike lock-alerts] Full-screen intent target: shows over the lock screen and turns the screen on. */
class FullScreenAlertActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SpikeLog.init(this)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val text = intent.getStringExtra("text") ?: "POS alert"
        SpikeLog.ev("fsi_shown", mapOf("alert_id" to intent.getStringExtra("alert_id")))
        val v = TextView(this).apply {
            this.text = "$text\n\n(tap to close)"
            textSize = 32f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#B00020"))
            setOnClickListener { finish() }
        }
        setContentView(v)
    }
}
