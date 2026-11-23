package pos.tablet

import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * 05b M-11: the full-screen-intent target for `urgent` alerts only. Shown over the lock screen, turns the screen
 * on and shows the lock text big; a tap opens the deep link (M-12) through the launcher activity, after the
 * keyguard is dismissed (no credential on our tablets, so that is a swipe at most). Own task affinity, so it never
 * brings the WebView task forward by itself; in lock task (N-13) it is our own package, so it is allowed.
 * Runs in the main process; [Notifier] in `:alerts` attaches it with [pendingIntent].
 */
class FullScreenAlertActivity : AppCompatActivity() {
    private var alertId: String? = null
    private var label: TextView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val v = TextView(this).apply {
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#B00020"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 40f)
            val pad = (32 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            setOnClickListener { open() }
        }
        label = v
        setContentView(v)
        show(intent)
    }

    /** A newer urgent alert while this one is up replaces it (singleInstance). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        show(intent)
    }

    private fun show(i: Intent?) {
        alertId = DeepLink.alertId(i?.getStringExtra(DeepLink.EXTRA_ALERT_ID))
        val text = i?.getStringExtra(EXTRA_TEXT)?.takeIf { it.isNotBlank() } ?: "POS"
        label?.text = text
        Log.i(TAG, "fsi shown alert_id=$alertId")
    }

    private fun open() {
        val id = alertId
        val km = getSystemService(KeyguardManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && km != null && km.isKeyguardLocked) {
            km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() = launch(id)
            })
        } else {
            launch(id)
        }
    }

    private fun launch(id: String?) {
        startActivity(mainIntent(this, id))
        finish()
    }

    companion object {
        private const val TAG = "PosFsi"
        const val EXTRA_TEXT = "text"

        /** The launcher activity with the tapped id (M-12); same shape as the notification's content intent. */
        fun mainIntent(ctx: Context, alertId: String?): Intent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setClassName(ctx, "pos.tablet.MainActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .apply { if (alertId != null) putExtra(DeepLink.EXTRA_ALERT_ID, alertId) }

        /** M-11: the full-screen intent for an urgent alert's notification (built in `:alerts`). */
        fun pendingIntent(ctx: Context, alertId: String, text: String): PendingIntent {
            val i = Intent()
                .setClassName(ctx, "pos.tablet.FullScreenAlertActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
                .putExtra(DeepLink.EXTRA_ALERT_ID, alertId)
                .putExtra(EXTRA_TEXT, text)
            return PendingIntent.getActivity(
                ctx, alertId.hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
    }
}
