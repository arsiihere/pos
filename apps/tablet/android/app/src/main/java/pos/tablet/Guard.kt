package pos.tablet

import java.net.URI

/**
 * 05b §3.6 (O-14, N-8): which page may call which `PosNative` method. Pure: the plugin passes the WebView's
 * main-frame URL (read on the UI thread) and the stored hub origin. The **origin** is the boundary; the
 * `/pair` path check inside the hub origin only guards against mistakes. No method exits lock task.
 */
object Guard {
    /** Capacitor's local origin for the bundled pages (M-1). */
    const val BUNDLED_ORIGIN = "https://localhost"

    enum class Rule { BUNDLED_ONLY, HUB_PAIR_ONLY, HUB_ANY, HUB_OR_BUNDLED }

    /** §3.6 table. A method not listed here is refused. */
    val RULES: Map<String, Rule> = mapOf(
        "probeHub" to Rule.BUNDLED_ONLY,
        "setHubOrigin" to Rule.BUNDLED_ONLY,
        "getHubOrigin" to Rule.BUNDLED_ONLY,
        "setDeviceToken" to Rule.HUB_PAIR_ONLY,
        "confirmRevoked" to Rule.HUB_ANY,
        "setSession" to Rule.HUB_OR_BUNDLED,
        "setDeviceContext" to Rule.HUB_OR_BUNDLED,
        "reportShown" to Rule.HUB_OR_BUNDLED,
        "info" to Rule.HUB_OR_BUNDLED,
        "health" to Rule.HUB_OR_BUNDLED,
        "setWakeLock" to Rule.HUB_OR_BUNDLED,
        "checkForUpdate" to Rule.HUB_OR_BUNDLED,
        "openSetting" to Rule.HUB_OR_BUNDLED,
        "addListener" to Rule.HUB_OR_BUNDLED,
    )

    /** (scheme, host, effective port, raw path); null when the URL is not a plain absolute http(s) URL. */
    private data class Parts(val scheme: String, val host: String, val port: Int, val path: String)

    private fun parse(url: String?): Parts? {
        if (url.isNullOrBlank()) return null
        val u = try { URI(url) } catch (e: Exception) { return null }
        val scheme = u.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        if (u.rawUserInfo != null) return null
        val host = u.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        val port = when {
            u.port != -1 -> u.port
            scheme == "http" -> 80
            else -> 443
        }
        val path = u.rawPath.orEmpty().ifEmpty { "/" }
        return Parts(scheme, host, port, path)
    }

    private fun sameOrigin(a: Parts, b: Parts) = a.scheme == b.scheme && a.host == b.host && a.port == b.port

    /** True when [method] may run for a page whose main frame is at [pageUrl]. */
    fun allowed(method: String, pageUrl: String?, hubOrigin: String?): Boolean {
        val rule = RULES[method] ?: return false
        val page = parse(pageUrl) ?: return false
        val bundled = parse(BUNDLED_ORIGIN)!!
        val onBundled = sameOrigin(page, bundled)
        val hub = HubOrigin.normalize(hubOrigin)?.let { parse(it) }
        val onHub = hub != null && sameOrigin(page, hub)
        return when (rule) {
            Rule.BUNDLED_ONLY -> onBundled
            Rule.HUB_PAIR_ONLY -> onHub && page.path == "/pair"
            Rule.HUB_ANY -> onHub
            Rule.HUB_OR_BUNDLED -> onHub || onBundled
        }
    }
}

/** M-1 / M-16: the hub origin is `http://host:port`, the port required; nothing after the port but an optional `/`. */
object HubOrigin {
    /** The normalised origin (`http://host:port`, host lower-case), or null when [input] is not one. */
    fun normalize(input: String?): String? {
        val s = input?.trim() ?: return null
        if (s.isEmpty()) return null
        val u = try { URI(s) } catch (e: Exception) { return null }
        if (u.scheme?.lowercase() != "http") return null
        if (u.rawUserInfo != null || u.rawQuery != null || u.rawFragment != null) return null
        val path = u.rawPath.orEmpty()
        if (path != "" && path != "/") return null
        val host = u.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        if (u.port !in 1..65535) return null
        // URI keeps IPv6 brackets in host; keep them as given.
        return "http://$host:${u.port}"
    }
}

/** M-3: native keeps a token only for a device approved as a tablet. */
object TokenRule {
    const val NOT_TABLET_CODE = "NOT_TABLET"
    const val NOT_TABLET_MESSAGE = "Approve this tablet as a Tablet"

    sealed class Result {
        data object Ok : Result()
        data class Invalid(val message: String) : Result()
        data object NotTablet : Result()
    }

    fun check(token: String?, deviceId: String?, deviceType: String?): Result = when {
        token.isNullOrBlank() || deviceId.isNullOrBlank() || deviceType.isNullOrBlank() ->
            Result.Invalid("token, device_id and device_type are required")
        deviceType != "tablet" -> Result.NotTablet
        else -> Result.Ok
    }
}
