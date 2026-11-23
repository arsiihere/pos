package pos.tablet

import org.json.JSONArray
import org.json.JSONObject

/**
 * 05b §2 / M-4: the alert-mode frames the hub sends (01d §3.7; shapes in packages/events/src/ws.ts and
 * apps/hub/src/alerts/alert-sockets.ts). Pure Kotlin + org.json, unit-tested (test 14, parsing part).
 *
 * - `alerts_open { alerts: [row], binding_route_until: int | null }` — rows are lock views plus `seen_by_me`
 *   and (05b D-4, additive) `from_business_day` (YYYY-MM-DD or null).
 * - `alert { alert: view }` — a live step (lock view on alert mode).
 * - `alert_seen { alert_id }`, `alert_closed { alert_id, reason, decision, by_name }`.
 * - `binding_route { until }` (01d BF-5) — feeds `state.binding_route_until`.
 * Anything else, or a frame that does not parse, is [Frame.Ignored]: never a crash.
 */
data class AlertItem(
    val alertId: String,
    val step: Int,
    val kind: String,
    val family: String,
    val raisedAt: Long?,
    /** The lock view (`kind_label_key` + lock-safe codes). Never rendered text (§2). */
    val lock: JSONObject,
    /** AD-82: a `request_result`'s outcome (lock-safe), else null. */
    val outcome: String?,
    val seenByMe: Boolean,
    /** D-4: non-null for an alert raised before the current business day (listed without sound). */
    val fromBusinessDay: String?,
    /** "alerts_open" | "alert" (M-19 `alert_received.via`). */
    val via: String,
) {
    val key: String get() = "$alertId:$step"

    /** The lock view with `outcome` added when the view has one, for [LockText.soundFamily] (result sounds). */
    fun lockForText(): JSONObject {
        if (outcome == null) return lock
        return JSONObject(lock.toString()).put("outcome", outcome)
    }
}

sealed class Frame {
    data class AlertsOpen(val rows: List<AlertItem>, val bindingRouteUntil: Long?, val badRows: Int) : Frame()
    data class Alert(val item: AlertItem) : Frame()
    data class Seen(val alertId: String) : Frame()
    data class Closed(val alertId: String) : Frame()
    data class BindingRoute(val until: Long?) : Frame()
    data class Ignored(val type: String?, val why: String) : Frame()
}

object Frames {
    fun parse(text: String): Frame {
        val o = try { JSONObject(text) } catch (e: Exception) { return Frame.Ignored(null, "not_json") }
        val type = o.optString("type", "")
        return try {
            when (type) {
                "alerts_open" -> {
                    val arr: JSONArray = o.optJSONArray("alerts") ?: return Frame.Ignored(type, "no_alerts")
                    val rows = ArrayList<AlertItem>(arr.length())
                    var bad = 0
                    for (i in 0 until arr.length()) {
                        val r = arr.optJSONObject(i)?.let { item(it, "alerts_open") }
                        if (r == null) bad++ else rows.add(r)
                    }
                    Frame.AlertsOpen(rows, longOrNull(o, "binding_route_until"), bad)
                }
                "alert" -> {
                    val a = o.optJSONObject("alert") ?: return Frame.Ignored(type, "no_alert")
                    val it = item(a, "alert") ?: return Frame.Ignored(type, "bad_alert")
                    Frame.Alert(it)
                }
                "alert_seen" -> id(o)?.let { Frame.Seen(it) } ?: Frame.Ignored(type, "no_alert_id")
                "alert_closed" -> id(o)?.let { Frame.Closed(it) } ?: Frame.Ignored(type, "no_alert_id")
                "binding_route" -> Frame.BindingRoute(longOrNull(o, "until"))
                else -> Frame.Ignored(type, "unknown_type")
            }
        } catch (e: Exception) {
            Frame.Ignored(type, "bad_shape")
        }
    }

    private fun id(o: JSONObject): String? = strOrNull(o, "alert_id")?.takeIf { it.isNotEmpty() }

    private fun item(a: JSONObject, via: String): AlertItem? {
        val alertId = strOrNull(a, "alert_id")?.takeIf { it.isNotEmpty() } ?: return null
        val stepAny = a.opt("step")
        if (stepAny !is Number) return null
        val step = stepAny.toInt()
        if (step < 0) return null
        val kind = strOrNull(a, "kind")?.takeIf { it.isNotEmpty() } ?: return null
        val family = strOrNull(a, "family")?.takeIf { it.isNotEmpty() } ?: return null
        val lock = a.optJSONObject("lock") ?: return null
        return AlertItem(
            alertId = alertId,
            step = step,
            kind = kind,
            family = family,
            raisedAt = longOrNull(a, "raised_at"),
            lock = lock,
            outcome = strOrNull(a, "outcome"),
            seenByMe = a.optBoolean("seen_by_me", false),
            fromBusinessDay = strOrNull(a, "from_business_day")?.takeIf { it.isNotEmpty() },
            via = via,
        )
    }

    private fun strOrNull(o: JSONObject, k: String): String? {
        val v = o.opt(k)
        return if (v is String) v else null
    }

    private fun longOrNull(o: JSONObject, k: String): Long? {
        val v = o.opt(k)
        return if (v is Number) v.toLong() else null
    }
}
