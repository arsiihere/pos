package pos.tablet

import java.net.URI

/** What the launcher activity does with a tapped alert (05b M-12). */
sealed class TapAction {
    /** The hub's staff page is loaded: run [script] with `evaluateJavascript` (a hash change, no reload). */
    data class SetHash(val script: String) : TapAction()

    /** No hub page in this WebView yet: keep the id; the next start that loads `/staff/` uses [DeepLink.staffPath]. */
    data class LoadWithHash(val alertId: String) : TapAction()
}

/**
 * 05b M-11 / M-12 deep link, pure so it is unit-tested. The id comes from an intent (MainActivity is exported),
 * so it is accepted only as a canonical ULID — 26 upper-case Crockford base32 characters, the first ≤ `7`
 * (128 bits) — which also makes it safe to put inside the JS string and the URL fragment unescaped.
 */
object DeepLink {
    const val EXTRA_ALERT_ID = "alert_id"

    private val ULID = Regex("^[0-7][0-9A-HJKMNP-TV-Z]{25}$")

    fun isUlid(id: String?): Boolean = id != null && ULID.matches(id)

    /** The validated id, or null. */
    fun alertId(raw: String?): String? = raw?.takeIf(::isUlid)

    fun hash(id: String): String {
        require(isUlid(id)) { "not a ULID" }
        return "#/inbox?focus=alert:$id"
    }

    /** M-12: `location.hash = '#/inbox?focus=alert:<id>'` — the session stays in page memory. */
    fun script(id: String): String = "location.hash = '${hash(id)}'"

    /** M-12: the start path when the page has to be loaded (`/staff/` + the hash). */
    fun staffPath(id: String): String = StartPage.STAFF_PATH + hash(id)

    /**
     * [currentUrl] = the WebView's URL now; [hubOrigin] = the `server.url` the bridge was started with (null =
     * bundled pages). The hub page counts as loaded when the URL is on that origin under `/staff/`.
     */
    fun onTap(id: String, currentUrl: String?, hubOrigin: String?): TapAction =
        if (isHubStaffPage(currentUrl, hubOrigin)) TapAction.SetHash(script(id)) else TapAction.LoadWithHash(id)

    fun isHubStaffPage(currentUrl: String?, hubOrigin: String?): Boolean {
        if (!StartPage.sameOrigin(currentUrl, hubOrigin)) return false
        val path = try { URI(currentUrl).path } catch (e: Exception) { null } ?: return false
        return path.startsWith(StartPage.STAFF_PATH)
    }

    /**
     * The start path for a start that chose [chosenPath]: a pending tap is applied only to the hub's `/staff/`
     * (the bundled first-run / unreachable pages keep it pending until the hub loads). Returns the path to load
     * and whether the pending id was used.
     */
    fun startPath(chosenPath: String, pendingId: String?): Pair<String, Boolean> =
        if (pendingId != null && isUlid(pendingId) && chosenPath == StartPage.STAFF_PATH) staffPath(pendingId) to true
        else chosenPath to false
}
