package pos.tablet

import java.net.URI
import java.net.URLEncoder

/**
 * 05b M-1 start-page choice. [serverUrl] is the hub origin only (`http://host:port`, never a path) or null for
 * the bundled pages on Capacitor's local origin `https://localhost`; [startPath] always starts with `/`.
 */
data class StartChoice(val serverUrl: String?, val startPath: String)

/** 05b M-1 / M-16 / §3.4: pure, so the choice is unit-tested; MainActivity runs it off the main thread (N-3). */
object StartPage {
    const val STAFF_PATH = "/staff/"
    const val FIRST_RUN_PATH = "/index.html"
    const val UNREACHABLE_PATH = "/unreachable.html"

    /**
     * [stored] = MainStore.hubOrigin (re-read at every start, so a `setHubOrigin` + `recreate()` takes effect).
     * [forcedReason] = a main-frame load failure from the last WebView (N-2): show the unreachable page without
     * probing, so a hub whose `/health` answers but whose page fails does not loop at full speed.
     */
    fun choose(stored: String?, forcedReason: String?, probe: (String) -> ProbeResult): StartChoice {
        val origin = stored?.let { HubProbe.normaliseOrigin(it) } ?: return StartChoice(null, FIRST_RUN_PATH)
        if (forcedReason != null) return StartChoice(null, unreachablePath(origin, forcedReason))
        val r = try { probe(origin) } catch (e: Exception) { ProbeResult(false, HubProbe.NO_HUB, null) }
        return if (r.ok) StartChoice(origin, STAFF_PATH)
        else StartChoice(null, unreachablePath(origin, r.reason ?: HubProbe.NO_HUB))
    }

    fun unreachablePath(origin: String, reason: String): String =
        "$UNREACHABLE_PATH?origin=${enc(origin)}&reason=${enc(reason)}"

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** True when [url] is on exactly [origin] (scheme, host, port; `http` default port 80). */
    fun sameOrigin(url: String?, origin: String?): Boolean {
        if (url == null || origin == null) return false
        return try {
            val a = URI(url)
            val b = URI(origin)
            a.scheme.equals(b.scheme, true) && a.host.equals(b.host, true) && port(a) == port(b)
        } catch (e: Exception) {
            false
        }
    }

    private fun port(u: URI): Int = if (u.port != -1) u.port else when (u.scheme?.lowercase()) {
        "http" -> 80
        "https" -> 443
        else -> -1
    }

    /** N-2: the reason shown when the hub's main-frame load fails (network error, or HTTP [status] when > 0). */
    fun mainFrameFailureReason(status: Int): String = when {
        status <= 0 -> HubProbe.NO_HUB
        status >= 500 -> HubProbe.STARTING
        else -> HubProbe.NOT_POS
    }
}
