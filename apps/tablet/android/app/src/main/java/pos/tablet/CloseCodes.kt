package pos.tablet

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 05b §3.5 close-code rule (O-13): a close code never wipes the token by itself.
 * Pure decisions here; [TokenCheck] is the one HTTP call that may confirm a revoke.
 */
object CloseCodes {
    enum class Action {
        /** 4401 / 4403: run the HTTP check before doing anything with the token. */
        CHECK_TOKEN,
        /** 4409: replaced by a newer socket for this device; health row, reconnect after 60 s. */
        REPLACED,
        /** 4426: client upgrade required; checkForUpdate (A14), keep reconnecting with backoff. */
        UPGRADE_REQUIRED,
        /** Anything else (1000, 1006, 1011, 1012, …): reconnect with backoff. */
        RECONNECT,
    }

    fun decide(code: Int): Action = when (code) {
        4401, 4403 -> Action.CHECK_TOKEN
        4409 -> Action.REPLACED
        4426 -> Action.UPGRADE_REQUIRED
        else -> Action.RECONNECT
    }

    /** Outcome of the `GET /app/android/latest` check. [reason] is the hub error code (or UNREACHABLE). */
    sealed class Check(val reason: String?) {
        /** `401 DEVICE_TOKEN_INVALID` or `403 DEVICE_REVOKED`: clear the native token, stop, `paired: false`. */
        class Revoked(reason: String) : Check(reason)
        /** `GUEST_NETWORK_FORBIDDEN`: keep the token, "Connect to the staff Wi-Fi", back off. */
        object Guest : Check("GUEST_NETWORK_FORBIDDEN")
        /** `HOST_NOT_ALLOWED`: keep the token, "Open the hub by its address", back off. */
        object Host : Check("HOST_NOT_ALLOWED")
        /** Any other answer (200, 404 ROUTE_NOT_FOUND, 403 DEVICE_TYPE_NOT_ALLOWED, …): keep, reconnect. */
        class Keep(reason: String?) : Check(reason)
        /** No answer (network error, timeout): keep, reconnect. */
        object Unreachable : Check("UNREACHABLE")
    }

    /** Maps an HTTP answer to [Check]. [errorCode] = the envelope's `error.code` (`{ error: { code, … } }`). */
    fun classify(status: Int, errorCode: String?): Check = when {
        status == 401 && errorCode == "DEVICE_TOKEN_INVALID" -> Check.Revoked("DEVICE_TOKEN_INVALID")
        status == 403 && errorCode == "DEVICE_REVOKED" -> Check.Revoked("DEVICE_REVOKED")
        errorCode == "GUEST_NETWORK_FORBIDDEN" -> Check.Guest
        errorCode == "HOST_NOT_ALLOWED" -> Check.Host
        else -> Check.Keep(errorCode ?: status.toString())
    }

    /** 00 §8.4 texts for the status notification / the page (§3.5). */
    fun statusText(check: Check): String? = when (check) {
        is Check.Guest -> "Connect to the staff Wi-Fi"
        is Check.Host -> "Open the hub by its address"
        else -> null
    }

    /** `{ error: { code } }` → code, or null for any other body. */
    fun errorCode(body: String?): String? {
        if (body.isNullOrEmpty()) return null
        return try {
            JSONObject(body).optJSONObject("error")?.optString("code", "")?.takeIf { it.isNotEmpty() }
        } catch (_: Exception) {
            null
        }
    }
}

/** The §3.5 HTTP check, swappable in tests. Blocking: call it off the worker thread. */
fun interface TokenChecker {
    fun check(hubOrigin: String, token: String): CloseCodes.Check
}

/**
 * `GET <hub_origin>/app/android/latest` with `Authorization: Bearer <token>` and `X-Client-Version`
 * (H-3). The route's guards run host → guest → version → device (apps/hub/src/auth/guards.ts), so a guest
 * or host refusal comes before the token is looked at; `requireTablet` then answers 401 / 403 / 404.
 */
class TokenCheck(
    private val clientVersion: String,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(3, TimeUnit.SECONDS)
        .callTimeout(5, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build(),
) : TokenChecker {
    override fun check(hubOrigin: String, token: String): CloseCodes.Check {
        val req = try {
            Request.Builder()
                .url(hubOrigin.trimEnd('/') + "/app/android/latest")
                .header("Authorization", "Bearer $token")
                .header("X-Client-Version", clientVersion)
                .get()
                .build()
        } catch (_: Exception) {
            return CloseCodes.Check.Unreachable
        }
        return try {
            client.newCall(req).execute().use { resp ->
                val body = try { resp.body?.string() } catch (_: Exception) { null }
                CloseCodes.classify(resp.code, CloseCodes.errorCode(body))
            }
        } catch (_: Exception) {
            CloseCodes.Check.Unreachable
        }
    }
}
