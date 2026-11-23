package pos.tablet

import android.content.Context
import org.json.JSONObject

/**
 * 05b M-9 interface (lane 4 implements from assets/lock-strings.json; this stub is replaced).
 * The alert service (lane 3) calls only these three functions.
 */
object LockText {
    /** The notification line for an alert-mode `lock` view, in [language] ('en' | 'ur'). */
    fun render(ctx: Context, kind: String, lock: JSONObject, language: String): String =
        lock.optString("kind_label_key", kind)

    /** True for a `silent` kind (no notification at all; 01d SILENT_KINDS). */
    fun isSilent(ctx: Context, kind: String): Boolean = kind == "approval_receipt"

    /** The sound family for an alert: "urgent" | "action" | "info" | "result_approved" | "result_rejected". */
    fun soundFamily(ctx: Context, kind: String, family: String, lock: JSONObject): String = family
}
