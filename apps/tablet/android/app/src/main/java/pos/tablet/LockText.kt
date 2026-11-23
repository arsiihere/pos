package pos.tablet

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * 05b M-9: notification text and sound rules from the generated `assets/lock-strings.json` (loaded once per
 * process; the rules live in [LockStrings]). The alert service calls only these three functions.
 *
 * [lock] may be the alert view's `lock` object or the whole alert view (`{ kind, family, outcome, lock, … }`).
 * Pass the whole view where you can: a `request_result`'s `outcome` (AD-82) and the `family` (for the generic text
 * of an unknown key) are fields of the view, not of its `lock`. With only the `lock`, `outcome` / `family` are read
 * from it if present.
 */
object LockText {
    private const val TAG = "pos.LockText"
    private const val ASSET = "lock-strings.json"

    @Volatile private var strings: LockStrings? = null

    private fun strings(ctx: Context): LockStrings =
        strings ?: synchronized(this) {
            strings ?: LockStrings(ctx.applicationContext.assets.open(ASSET).bufferedReader(Charsets.UTF_8).use { it.readText() })
                .also { strings = it }
        }

    /** The notification line for an alert-mode `lock` view, in [language] ('en' | 'ur'; anything else reads 'en'). */
    fun render(ctx: Context, kind: String, lock: JSONObject, language: String): String {
        return strings(ctx).lineOf(kind, lock, language) { key ->
            Log.w(TAG, "no lock text for $key (kind $kind): generic text used")
        }
    }

    /** True for a `silent` kind (no notification at all; 01d SILENT_KINDS). */
    fun isSilent(ctx: Context, kind: String): Boolean = strings(ctx).isSilent(kind)

    /**
     * The sound family for an alert: "urgent" | "action" | "info" | "result_approved" | "result_rejected", or
     * [LockStrings.NONE] ("none": post without a sound — a silent kind, or a `withdrawn` request_result, as the page's
     * soundFor returns null for it).
     */
    fun soundFamily(ctx: Context, kind: String, family: String, lock: JSONObject): String =
        strings(ctx).soundOf(kind, family, lock)
}
