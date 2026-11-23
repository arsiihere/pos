package pos.tablet

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 05b M-16 probe result. [reason] is one of [HubProbe.OK], [HubProbe.NO_HUB], [HubProbe.GUEST],
 * [HubProbe.NOT_POS], [HubProbe.HOST_NOT_ALLOWED], [HubProbe.STARTING], [HubProbe.BAD_ADDRESS];
 * [message] is the English text the bundled pages show (null when OK).
 */
data class ProbeResult(val ok: Boolean, val reason: String?, val message: String?)

/**
 * 05b M-16 (with N-7) hub probe: `GET <origin>/health` with a 3 s budget (M-1 / N-3). Blocking — call it
 * off the main thread. Native only: the bundled pages never call the hub from JS (H-3).
 */
object HubProbe {
    const val OK = "ok"
    const val NO_HUB = "no_hub"
    const val GUEST = "guest"
    const val NOT_POS = "not_pos"
    const val HOST_NOT_ALLOWED = "host_not_allowed"
    const val STARTING = "starting"
    const val BAD_ADDRESS = "bad_address"

    /** The M-16 texts, by reason. The bundled pages carry the same table (www/common.js). */
    val MESSAGES: Map<String, String> = mapOf(
        NO_HUB to "No hub at this address",
        GUEST to "Connect to the staff Wi-Fi",
        NOT_POS to "Not a POS hub",
        HOST_NOT_ALLOWED to "Use the address shown on the hub's setup page (with the port)",
        STARTING to "The hub is starting…",
        BAD_ADDRESS to "Type the address with its port, for example 192.168.1.10:3000",
    )

    private val baseClient: OkHttpClient by lazy {
        OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
    }

    fun probe(origin: String): ProbeResult = probe(origin, Spec.PROBE_TIMEOUT_MS)

    internal fun probe(origin: String, timeoutMs: Long): ProbeResult {
        val o = normaliseOrigin(origin) ?: return fail(BAD_ADDRESS)
        val client = baseClient.newBuilder()
            .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .build()
        val req = Request.Builder().url("$o/health")
            .header("Accept", "application/json")
            .header("X-Client-Version", BuildConfig.VERSION_NAME) // H-3
            .get().build()
        val (code, body) = try {
            client.newCall(req).execute().use { r -> r.code to (r.body?.string() ?: "") }
        } catch (e: Exception) {
            return fail(NO_HUB) // connect refused, unreachable, timeout (N-3)
        }
        return classify(code, body)
    }

    /** Maps an HTTP answer from `/health` to the M-16 table (pure; unit-tested). */
    fun classify(code: Int, body: String): ProbeResult {
        val json = try { JSONObject(body) } catch (e: Exception) { null }
        if (code != 200) {
            val errCode = json?.optJSONObject("error")?.optString("code", "")
            return when (errCode) {
                "HOST_NOT_ALLOWED" -> fail(HOST_NOT_ALLOWED)
                else -> fail(NOT_POS)
            }
        }
        val data = json?.optJSONObject("data") ?: return fail(NOT_POS)
        val keys = data.keys().asSequence().toList()
        if (keys == listOf("status")) return fail(GUEST) // N-7: the guest answer has only `status`
        if (!data.has("hub_version") || data.isNull("hub_version")) return fail(NOT_POS)
        val ready = data.optString("status") == "ready" && data.optBoolean("provisioned", false)
        return if (ready) ProbeResult(true, OK, null) else fail(STARTING)
    }

    private fun fail(reason: String) = ProbeResult(false, reason, MESSAGES[reason])

    private val HOST = Regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$")

    /**
     * M-16: `host:port` (port mandatory), optionally typed with `http://` and a trailing `/`.
     * Returns `http://host:port` (origin only, M-1), or null. No path, query, user info, https or IPv6.
     */
    fun normaliseOrigin(input: String): String? {
        var s = input.trim()
        if (s.isEmpty()) return null
        val schemeIdx = s.indexOf("://")
        if (schemeIdx >= 0) {
            if (!s.substring(0, schemeIdx).equals("http", ignoreCase = true)) return null
            s = s.substring(schemeIdx + 3)
        }
        if (s.endsWith("/")) s = s.dropLast(1)
        if (s.isEmpty() || s.any { it == '/' || it == '?' || it == '#' || it == '@' || it.isWhitespace() }) return null
        val colon = s.lastIndexOf(':')
        if (colon <= 0 || colon != s.indexOf(':')) return null
        val host = s.substring(0, colon).lowercase()
        val portStr = s.substring(colon + 1)
        if (portStr.isEmpty() || portStr.length > 5 || !portStr.all { it in '0'..'9' }) return null
        val port = portStr.toInt()
        if (port !in 1..65535) return null
        if (!HOST.matches(host)) return null
        if (host.all { it.isDigit() || it == '.' }) {
            val parts = host.split('.')
            if (parts.size != 4 || parts.any { it.isEmpty() || it.length > 3 || it.toInt() > 255 }) return null
        }
        return "http://$host:$port"
    }
}
