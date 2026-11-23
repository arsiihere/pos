package pos.spike.lockalerts

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONArray
import org.json.JSONObject

/**
 * [spike lock-alerts] Storage.
 * - Hub URL + device token: EncryptedSharedPreferences (Keystore master key), 00 §8.1 style.
 *   The service reads the token from here, never from the WebView (01d §8.2).
 * - Toggles: plain prefs.
 * - Seen (alert_id, step) keys: plain prefs, last MAX_SEEN, so a restart never notifies twice.
 */
object SpikeStore {
    private const val SECURE = "spike_secure"
    private const val PLAIN = "spike_plain"
    private const val MAX_SEEN = 2000

    const val T_WAKE_LOCK = "wake_lock"
    const val T_WIFI_LOCK = "wifi_lock"
    const val T_PING_S = "ping_s"
    const val T_URGENT = "urgent_fsi"

    @Volatile private var secure: SharedPreferences? = null

    private fun secure(ctx: Context): SharedPreferences {
        secure?.let { return it }
        synchronized(this) {
            secure?.let { return it }
            val master = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
            val p = EncryptedSharedPreferences.create(
                SECURE,
                master,
                ctx.applicationContext,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            secure = p
            return p
        }
    }

    private fun plain(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PLAIN, Context.MODE_PRIVATE)

    fun setCredentials(ctx: Context, hubUrl: String, token: String) {
        secure(ctx).edit().putString("hub_url", hubUrl.trimEnd('/')).putString("device_token", token).apply()
    }

    fun clearToken(ctx: Context) {
        secure(ctx).edit().remove("device_token").apply()
    }

    fun hubUrl(ctx: Context): String? = secure(ctx).getString("hub_url", null)
    fun token(ctx: Context): String? = secure(ctx).getString("device_token", null)

    fun wantRunning(ctx: Context): Boolean = plain(ctx).getBoolean("want_running", false)
    fun setWantRunning(ctx: Context, v: Boolean) { plain(ctx).edit().putBoolean("want_running", v).apply() }

    fun toggles(ctx: Context): JSONObject {
        val p = plain(ctx)
        return JSONObject()
            .put(T_WAKE_LOCK, p.getBoolean(T_WAKE_LOCK, true))
            .put(T_WIFI_LOCK, p.getBoolean(T_WIFI_LOCK, true))
            .put(T_PING_S, p.getInt(T_PING_S, 15))
            .put(T_URGENT, p.getBoolean(T_URGENT, true))
    }

    fun bool(ctx: Context, key: String): Boolean = toggles(ctx).getBoolean(key)
    fun pingS(ctx: Context): Int = plain(ctx).getInt(T_PING_S, 15)

    fun setToggle(ctx: Context, key: String, value: String) {
        val e = plain(ctx).edit()
        when (key) {
            T_PING_S -> e.putInt(key, value.toInt().coerceIn(0, 300))
            T_WAKE_LOCK, T_WIFI_LOCK, T_URGENT -> e.putBoolean(key, value == "true" || value == "1")
            else -> throw IllegalArgumentException("unknown toggle $key")
        }
        e.apply()
    }

    // ---- seen set (dedupe of (alert_id, step)) ----
    private var seenCache: LinkedHashSet<String>? = null

    @Synchronized
    private fun seen(ctx: Context): LinkedHashSet<String> {
        seenCache?.let { return it }
        val set = LinkedHashSet<String>()
        val raw = plain(ctx).getString("seen", null)
        if (raw != null) {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) set.add(arr.getString(i))
        }
        seenCache = set
        return set
    }

    /** True if the key is new (and records it). */
    @Synchronized
    fun markIfNew(ctx: Context, alertId: String, step: Int): Boolean {
        val set = seen(ctx)
        val key = "$alertId:$step"
        if (!set.add(key)) return false
        while (set.size > MAX_SEEN) set.remove(set.first())
        plain(ctx).edit().putString("seen", JSONArray(set.toList()).toString()).commit()
        return true
    }

    @Synchronized
    fun seenCount(ctx: Context): Int = seen(ctx).size
}
