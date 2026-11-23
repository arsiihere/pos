package pos.tablet

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/**
 * 05b M-22: a value that may fail to open or to read (EncryptedSharedPreferences after an OTA throws e.g.
 * `AEADBadTagException`). Every failure is caught, recorded in [error] for health (`store_readable`), and
 * reads as the default — never a crash loop. Pure, unit-tested with a fake [open].
 */
class Tolerant<T : Any>(private val open: () -> T, private val reset: () -> Unit = {}) {
    @Volatile private var value: T? = null
    @Volatile var error: String? = null
        private set

    val readable: Boolean get() = error == null

    private fun get(): T? {
        value?.let { return it }
        return synchronized(this) {
            value ?: try {
                open().also { value = it }
            } catch (e: Exception) {
                error = e.toString()
                null
            }
        }
    }

    fun <R> read(default: R, block: (T) -> R): R {
        val v = get() ?: return default
        return try { block(v) } catch (e: Exception) { error = e.toString(); default }
    }

    /** True if written. A store that cannot open is reset once ([reset], e.g. delete its file) and retried. */
    fun write(block: (T) -> Unit): Boolean {
        var v = get()
        if (v == null) {
            synchronized(this) {
                try { reset() } catch (_: Exception) {}
                value = null
                error = null
            }
            v = get() ?: return false
        }
        return try { block(v); error = null; true } catch (e: Exception) { error = e.toString(); false }
    }
}

/**
 * 05b §5 / N-10: the `:alerts` stores; only the `:alerts` process opens them.
 * - `alerts_secure` (EncryptedSharedPreferences, Keystore master key): `device_token`, `device_id`, and the
 *   service's copy of `hub_origin` (sent with setDeviceToken; the main process's own copy is `main_secure`).
 * - `alerts_plain`: `want_running`, `wake_lock` (default true), dedupe keys, open urgent set, `always_on`,
 *   `language` (default 'en'), `last_update_check`, `last_revoke` (05b O-20: sha256 of the last confirmed-revoked
 *   token + reason + time, never the token).
 */
object AlertsStore {
    private const val K_TOKEN = "device_token"
    private const val K_DEVICE_ID = "device_id"
    private const val K_ORIGIN = "hub_origin"

    @Volatile private var secureSlot: Tolerant<SharedPreferences>? = null

    private fun secure(ctx: Context): Tolerant<SharedPreferences> {
        secureSlot?.let { return it }
        val app = ctx.applicationContext
        return synchronized(this) {
            secureSlot ?: Tolerant(
                open = {
                    EncryptedSharedPreferences.create(
                        Stores.ALERTS_SECURE,
                        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
                        app,
                        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                    )
                },
                // M-22 re-pair path: an unreadable keyset is dropped so a new pairing can write again.
                reset = { app.deleteSharedPreferences(Stores.ALERTS_SECURE) },
            ).also { secureSlot = it }
        }
    }

    private fun plain(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(Stores.ALERTS_PLAIN, Context.MODE_PRIVATE)

    // ---- secure (M-22 tolerant) ----
    fun token(ctx: Context): String? = secure(ctx).read(null) { it.getString(K_TOKEN, null) }
    fun deviceId(ctx: Context): String? = secure(ctx).read(null) { it.getString(K_DEVICE_ID, null) }
    fun hubOrigin(ctx: Context): String? = secure(ctx).read(null) { it.getString(K_ORIGIN, null) }
    fun paired(ctx: Context): Boolean = !token(ctx).isNullOrEmpty() && !hubOrigin(ctx).isNullOrEmpty()

    /** M-18 "token store readable". */
    fun storeReadable(ctx: Context): Boolean { secure(ctx).read(Unit) { it.contains(K_TOKEN) }; return secure(ctx).readable }
    fun storeError(ctx: Context): String? = secure(ctx).error

    fun setCredentials(ctx: Context, token: String, deviceId: String, hubOrigin: String): Boolean =
        secure(ctx).write {
            it.edit().putString(K_TOKEN, token).putString(K_DEVICE_ID, deviceId)
                .putString(K_ORIGIN, hubOrigin.trim().trimEnd('/')).commit()
        }

    /** §3.5: only after the HTTP check confirmed the revoke. Keeps hub_origin (re-pair goes to the same hub). */
    fun clearToken(ctx: Context): Boolean =
        secure(ctx).write { it.edit().remove(K_TOKEN).remove(K_DEVICE_ID).commit() }

    // ---- plain ----
    fun wantRunning(ctx: Context): Boolean = plain(ctx).getBoolean("want_running", false)
    fun setWantRunning(ctx: Context, on: Boolean) { plain(ctx).edit().putBoolean("want_running", on).commit() }

    fun wakeLock(ctx: Context): Boolean = plain(ctx).getBoolean("wake_lock", true)
    fun setWakeLock(ctx: Context, on: Boolean) { plain(ctx).edit().putBoolean("wake_lock", on).commit() }

    fun alwaysOn(ctx: Context): Boolean = plain(ctx).getBoolean("always_on", false)
    fun language(ctx: Context): String = plain(ctx).getString("language", "en") ?: "en"
    fun setDeviceContext(ctx: Context, alwaysOn: Boolean, language: String) {
        plain(ctx).edit().putBoolean("always_on", alwaysOn).putString("language", language).commit()
    }

    fun lastUpdateCheck(ctx: Context): Long = plain(ctx).getLong("last_update_check", 0L)
    fun setLastUpdateCheck(ctx: Context, t: Long) { plain(ctx).edit().putLong("last_update_check", t).apply() }

    /** M-7 dedupe keys (JSON array), committed before a receipt is sent. */
    fun dedupeStore(ctx: Context): Persisted = plainString(ctx, "dedupe_keys")

    /** 05b O-20: the last confirmed revoke (see [RevokeMemory]). */
    fun revokeMemory(ctx: Context): RevokeMemory = RevokeMemory(plainString(ctx, "last_revoke"))

    /** M-10 open unseen urgent set (JSON object alert_id → step). */
    fun openUrgentStore(ctx: Context): Persisted = plainString(ctx, "open_urgent")

    private fun plainString(ctx: Context, key: String): Persisted = object : Persisted {
        override fun load(): String? = plain(ctx).getString(key, null)
        override fun save(value: String) { plain(ctx).edit().putString(key, value).commit() }
    }
}

/**
 * 05b M-8, M-21, O-18: `:alerts` memory-only state, lost with the process (by design: after a restart
 * `signed_in` is unknown until the page speaks, N-1). Written by AlertsReceiver, read by the service and A10 / A11.
 */
object AlertsMemory {
    /** null = unknown (no setSession since this process started). */
    @Volatile var signedIn: Boolean? = null
    @Volatile var staffId: String? = null
    @Volatile var activityVisible: Boolean? = null

    private val reported = LinkedHashSet<String>()

    /** M-8: `(alert_id, step)` keys the page reported as shown (A11 reads these). */
    @Synchronized fun addReported(alertId: String, step: Int) {
        reported.add("$alertId:$step")
        while (reported.size > Spec.DEDUPE_KEYS) reported.remove(reported.first())
    }

    @Synchronized fun wasReported(alertId: String, step: Int): Boolean = reported.contains("$alertId:$step")
    @Synchronized fun reportedKeys(): Set<String> = LinkedHashSet(reported)
}
