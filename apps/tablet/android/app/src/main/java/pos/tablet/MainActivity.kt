package pos.tablet

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import com.getcapacitor.BridgeActivity
import com.getcapacitor.CapConfig
import com.getcapacitor.WebViewListener

/**
 * 05b M-1 (N-2, N-3), M-4 render-process part, §3.4.
 *
 * `BridgeActivity.onCreate` calls `load()`; ours does nothing until the start page is chosen. The stored hub
 * origin is re-read and probed on a background thread (3 s, M-16) at every start — `setHubOrigin` +
 * `recreate()` is how the page switches. The probe's choice is kept and the activity recreated, and the next
 * `onCreate` sets `config` and runs the real `load()` there (the Bridge must exist before STARTED):
 * probe OK → `server.url` = the origin only + `startPath /staff/`; otherwise no `server.url`, so the bundled
 * pages on `https://localhost` (`index.html` first run, `unreachable.html?origin&reason`).
 */
class MainActivity : BridgeActivity() {
    private var loadAllowed = false
    private var splash: View? = null
    private val main = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(PosNativePlugin::class.java)
        super.onCreate(savedInstanceState) // its load() is deferred (below)
        if (BuildConfig.DEBUG && CrashLog.pending(this) != null) { // M-19 aid: read the crash without adb
            startActivity(Intent(this, CrashActivity::class.java))
            finish()
            return
        }
        if (savedInstanceState == null) takeTap(intent) // 05b A12: M-12 cold start; start() applies it
        if (findViewById<WebView>(com.getcapacitor.android.R.id.webview) == null) return // no WebView installed
        showSplash()
        // The Bridge registers activity-result launchers, which AndroidX allows only before STARTED; so it is
        // created here in onCreate, never from a later callback (device crash 2026-11-23, TCL 9198S, API 30).
        // The probe runs off the UI thread, keeps its choice and recreates; the new onCreate starts with it.
        val chosen = pendingChoice
        if (chosen != null) {
            pendingChoice = null
            start(chosen)
            return
        }
        val forced = pendingFailure
        pendingFailure = null
        val ctx = applicationContext
        Thread({
            val choice = StartPage.choose(MainStore.hubOrigin(ctx), forced, HubProbe::probe)
            main.post {
                if (!isFinishing && !isDestroyed) {
                    pendingChoice = choice
                    recreate()
                }
            }
        }, "hub-probe").start()
    }

    // 05b A15: M-17 (N-4, O-19) lock task follows main_plain `lock_task` at every resume, and when the plugin's
    // setDeviceContext changes it (PosNativePlugin calls applyLockTask on the UI thread). No page-callable exit.
    override fun onResume() {
        super.onResume()
        applyLockTask(resumed = true) // the Lifecycle reaches RESUMED only after onResume returns
    }

    fun applyLockTask(resumed: Boolean = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
        if (isFinishing || isDestroyed) return
        DeviceOwner.apply(this, MainStore.lockTask(this), resumed)
    }

    /** The first call (from `BridgeActivity.onCreate`) is deferred; [start] makes the real one. */
    override fun load() {
        if (loadAllowed) super.load()
    }

    private fun start(choice: StartChoice) {
        Log.i(TAG, "start serverUrl=${choice.serverUrl} startPath=${choice.startPath}")
        val b = CapConfig.Builder(this).setStartPath(tapStartPath(choice.startPath)) // 05b A12: M-12
        if (choice.serverUrl != null) b.setServerUrl(choice.serverUrl)
        config = b.create()
        loadAllowed = true
        load()
        val br = bridge ?: return
        br.setWebViewClient(HubWebViewClient(br, choice.serverUrl, ::onHubMainFrameFailed, ::onRenderGone))
        br.addWebViewListener(object : WebViewListener() {
            override fun onPageCommitVisible(view: WebView, url: String) = hideSplash()
            override fun onReceivedError(webView: WebView) = hideSplash()
        })
        // The activity's own start / resume ran before the bridge existed: replay them for the plugins.
        val state = lifecycle.currentState
        if (state.isAtLeast(Lifecycle.State.STARTED)) br.onStart()
        if (state.isAtLeast(Lifecycle.State.RESUMED)) {
            br.app.fireStatusChange(true)
            br.onResume()
        }
    }

    // 05b A12: M-12 notification / FSI tap (singleTask). The hub's staff page loaded → set the hash with
    // evaluateJavascript (no reload: the session is in page memory); otherwise keep the id and start again, and
    // the next start that loads /staff/ loads it with the hash. During a cold start's probe, start() applies it.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val id = takeTap(intent) ?: return
        val br = bridge
        if (!loadAllowed || br == null) return
        when (val a = DeepLink.onTap(id, br.webView?.url, br.serverUrl)) {
            is TapAction.SetHash -> {
                pendingFocus = null
                br.webView.evaluateJavascript(a.script, null)
            }
            is TapAction.LoadWithHash -> if (!isFinishing && !isDestroyed) recreate()
        }
    }

    /** The validated id of a tap intent (removed from it, so a recreate does not replay it), kept as pending. */
    private fun takeTap(i: Intent?): String? {
        if (i == null || (i.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null
        val id = DeepLink.alertId(i.getStringExtra(DeepLink.EXTRA_ALERT_ID))
        i.removeExtra(DeepLink.EXTRA_ALERT_ID)
        if (id != null) pendingFocus = id
        return id
    }

    private fun tapStartPath(chosen: String): String {
        val (path, used) = DeepLink.startPath(chosen, pendingFocus)
        if (used) pendingFocus = null
        return path
    }
    // 05b A12 end

    /** N-2: the hub's main frame failed to load → the bundled unreachable page, without a probe. */
    private fun onHubMainFrameFailed(reason: String) {
        Log.w(TAG, "hub main frame failed: $reason")
        pendingFailure = reason
        main.post { if (!isFinishing && !isDestroyed) recreate() }
    }

    /** M-4: renderer crash or OOM → handled; a fresh activity and WebView (the alert service is in `:alerts`). */
    private fun onRenderGone() {
        Log.w(TAG, "render process gone; recreating")
        main.post { if (!isFinishing && !isDestroyed) recreate() }
    }

    private fun showSplash() {
        val text = TextView(this).apply {
            text = getString(R.string.app_name) + "\nStarting…"
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#1F2933"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
        }
        val frame = FrameLayout(this).apply {
            setBackgroundColor(Color.WHITE)
            isClickable = true // swallow touches until the page shows
            addView(text, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        addContentView(frame, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        splash = frame
    }

    private fun hideSplash() {
        val s = splash ?: return
        splash = null
        (s.parent as? ViewGroup)?.removeView(s)
    }

    companion object {
        private const val TAG = "PosMain"

        /** Survives `recreate()` (same process): the failure the next start shows without probing. */
        @Volatile private var pendingFailure: String? = null

        /** The probe's start page, applied by the next onCreate (survives `recreate()`; same process). */
        @Volatile private var pendingChoice: StartChoice? = null

        /** 05b A12: M-12 a tapped alert not yet shown (survives `recreate()`). */
        @Volatile private var pendingFocus: String? = null
    }
}
