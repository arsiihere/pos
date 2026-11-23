package pos.tablet

import org.json.JSONObject
import java.security.MessageDigest

/**
 * 05b O-20 (§3.5, N-5, N-9; v1.0.1): native remembers the last token a hub confirmed revoked, so the page cannot
 * hand the same token back after native cleared its copy (a confirmRevoked → resumePaired → setDeviceToken loop).
 * The record is `{ token_sha256, reason, at }` (never the token itself) in a [Persisted] slot of `alerts_plain`.
 * Pure: no Android classes, unit-tested with an in-memory [Persisted].
 */
class RevokeMemory(private val store: Persisted, private val now: () -> Long = System::currentTimeMillis) {
    data class Record(val tokenSha256: String, val reason: String, val at: Long)

    companion object {
        const val TOKEN_REVOKED_CODE = "TOKEN_REVOKED"
        const val TOKEN_REVOKED_MESSAGE = "This tablet was removed. Pair it again."
        const val NO_NATIVE_TOKEN = "NO_NATIVE_TOKEN"

        /** Only a hub-confirmed revoke is remembered; the M-16 `hub_address_changed` clear is not. */
        val CONFIRMED_REASONS = setOf("DEVICE_TOKEN_INVALID", "DEVICE_REVOKED")

        fun sha256Hex(s: String): String =
            MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }

    fun record(): Record? {
        val raw = try { store.load() } catch (e: Exception) { null }
        if (raw.isNullOrEmpty()) return null
        return try {
            val o = JSONObject(raw)
            val sha = o.optString("token_sha256", "")
            val reason = o.optString("reason", "")
            if (sha.isEmpty() || reason.isEmpty()) null else Record(sha, reason, o.optLong("at", 0L))
        } catch (e: Exception) { null }
    }

    /** Called with the token native is about to clear. True when a record was written. */
    fun onRevoked(token: String?, reason: String): Boolean {
        if (reason !in CONFIRMED_REASONS || token.isNullOrEmpty()) return false
        store.save(JSONObject().put("token_sha256", sha256Hex(token)).put("reason", reason).put("at", now()).toString())
        return true
    }

    /** confirmRevoked when native holds no token: the remembered revoke, or NO_NATIVE_TOKEN as before. */
    fun answerWithoutToken(): JSONObject {
        val r = record() ?: return JSONObject().put("revoked", false).put("reason", NO_NATIVE_TOKEN)
        return JSONObject().put("revoked", true).put("reason", r.reason)
    }

    /** setDeviceToken: true when [token] is the one the hub revoked (refuse with TOKEN_REVOKED, change nothing). */
    fun refuses(token: String): Boolean {
        val r = record() ?: return false
        return r.tokenSha256 == sha256Hex(token)
    }

    /** Any other token was accepted: the record is done. */
    fun clear() {
        if (record() != null) store.save("")
    }
}
