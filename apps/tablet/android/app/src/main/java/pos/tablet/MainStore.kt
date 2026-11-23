package pos.tablet

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/**
 * 05b §5 / N-10: the main process's stores. Only the main process opens them.
 * main_secure: hub_origin (Keystore-backed). main_plain: lock_task.
 * M-22: a store that throws (e.g. AEADBadTagException after an OTA) reads as empty, never a crash loop.
 */
object MainStore {
    @Volatile private var secure: SharedPreferences? = null

    private fun secure(ctx: Context): SharedPreferences? {
        secure?.let { return it }
        return synchronized(this) {
            secure ?: try {
                EncryptedSharedPreferences.create(
                    Stores.MAIN_SECURE,
                    MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
                    ctx.applicationContext,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                ).also { secure = it }
            } catch (e: Exception) {
                storeError = e.toString()
                null
            }
        }
    }

    private fun plain(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(Stores.MAIN_PLAIN, Context.MODE_PRIVATE)

    /** Last store error (M-18 "token store readable"); null when fine. */
    @Volatile var storeError: String? = null
        private set

    /** The hub origin `http://host:port` (M-1), or null. */
    fun hubOrigin(ctx: Context): String? = try { secure(ctx)?.getString("hub_origin", null) } catch (e: Exception) { storeError = e.toString(); null }

    fun setHubOrigin(ctx: Context, origin: String?) {
        val s = secure(ctx) ?: return
        s.edit().apply { if (origin == null) remove("hub_origin") else putString("hub_origin", origin) }.commit()
    }

    /** M-17 / O-19: lock task wanted (profile audience `everyone`). */
    fun lockTask(ctx: Context): Boolean = plain(ctx).getBoolean("lock_task", false)
    fun setLockTask(ctx: Context, on: Boolean) { plain(ctx).edit().putBoolean("lock_task", on).apply() }
}
