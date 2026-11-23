package pos.tablet

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
 * `recreate()` is how the page switches. Then, on the UI thread, `config` is set and the real `load()` runs:
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
        if (findViewById<WebView>(com.getcapacitor.android.R.id.webview) == null) return // no WebView installed
        showSplash()
        val forced = pendingFailure
        pendingFailure = null
        val ctx = applicationContext
        Thread({
            val choice = StartPage.choose(MainStore.hubOrigin(ctx), forced, HubProbe::probe)
            main.post { if (!isFinishing && !isDestroyed) start(choice) }
        }, "hub-probe").start()
    }

    /** The first call (from `BridgeActivity.onCreate`) is deferred; [start] makes the real one. */
    override fun load() {
        if (loadAllowed) super.load()
    }

    private fun start(choice: StartChoice) {
        Log.i(TAG, "start serverUrl=${choice.serverUrl} startPath=${choice.startPath}")
        val b = CapConfig.Builder(this).setStartPath(choice.startPath)
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
    }
}
