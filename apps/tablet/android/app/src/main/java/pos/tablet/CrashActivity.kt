package pos.tablet

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Debug build only (MainActivity opens it): shows the last [CrashLog] report so it can be screenshotted. */
class CrashActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val report = CrashLog.pending(this) ?: "No crash report."
        val text = TextView(this).apply {
            text = report
            setTextColor(Color.BLACK)
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
            setPadding(24, 24, 24, 24)
        }
        val copy = Button(this).apply {
            setText("Copy")
            setOnClickListener {
                getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("crash", report))
                Toast.makeText(this@CrashActivity, "Copied", Toast.LENGTH_SHORT).show()
            }
        }
        val restart = Button(this).apply {
            setText("Clear and restart")
            setOnClickListener {
                CrashLog.clear(this@CrashActivity)
                startActivity(Intent(this@CrashActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                finish()
            }
        }
        val title = TextView(this).apply {
            setText("Arif POS crashed last time. Screenshot this and send it.")
            setTextColor(Color.RED)
            textSize = 16f
            setPadding(24, 24, 24, 8)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            addView(title)
            addView(LinearLayout(this@CrashActivity).apply { addView(copy); addView(restart) })
            addView(ScrollView(this@CrashActivity).apply { addView(text) })
        }
        setContentView(root)
    }
}
