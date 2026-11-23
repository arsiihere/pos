package pos.tablet

/** What the service does with its own post of one `(alert_id, step)` (05b M-8). */
enum class HoldAction {
    /** Post now: signed out, or the activity is known to be stopped (the page cannot show it). */
    POST_NOW,
    /** Wait up to [Spec.REPORT_SHOWN_HOLD_MS] for the page's `reportShown`. */
    HOLD,
    /** The page already reported this pair: the service posts nothing (the page owns it, M-10 / O-15). */
    DROP,
}

/** The page side as `:alerts` knows it (AlertsMemory): null = unknown since this process started (N-1). */
data class PageState(val signedIn: Boolean?, val activityVisible: Boolean?)

object ShownRule {
    /**
     * 05b M-8, M-21, N-1: signed in **or unknown** → hold (a `reportShown` drops the service's post); signed out →
     * post at once. Added (lane 5 decision): a stopped activity (O-18 `activity_visible` false) posts at once and
     * ignores a report, as a page in a stopped activity shows nothing the user can see.
     */
    fun decide(page: PageState, reported: Boolean): HoldAction = when {
        page.activityVisible == false -> HoldAction.POST_NOW
        reported -> HoldAction.DROP
        page.signedIn == false -> HoldAction.POST_NOW
        else -> HoldAction.HOLD
    }
}

/**
 * 05b M-8: one notification per alert when signed in. Pure, on the service's worker thread: [submit] replaces the
 * service's direct post; [post] runs now or when the hold ends without a report; [dropped] runs when the page
 * reported the pair (before the frame, or within the hold). Not thread-safe: call everything on [worker].
 */
class ShownHold(
    private val worker: Worker,
    private val page: () -> PageState,
    private val wasReported: (alertId: String, step: Int) -> Boolean,
    private val post: (item: AlertItem, withSound: Boolean) -> Unit,
    private val dropped: (item: AlertItem, withSound: Boolean) -> Unit,
    private val log: (ev: String, fields: Map<String, Any?>) -> Unit = { _, _ -> },
    private val holdMs: Long = Spec.REPORT_SHOWN_HOLD_MS,
) {
    private class Held(val item: AlertItem, val withSound: Boolean, val timer: Cancellable)
    private val held = LinkedHashMap<String, Held>()

    val heldCount: Int get() = held.size

    fun submit(item: AlertItem, withSound: Boolean) {
        held.remove(item.key)?.timer?.cancel() // the same pair again: the newer call wins
        when (ShownRule.decide(page(), wasReported(item.alertId, item.step))) {
            HoldAction.POST_NOW -> post(item, withSound)
            HoldAction.DROP -> {
                log("shown_by_page", mapOf("alert_id" to item.alertId, "step" to item.step, "held_ms" to 0))
                dropped(item, withSound)
            }
            HoldAction.HOLD -> {
                val t0 = worker.wallNow()
                val timer = worker.postDelayed(holdMs) {
                    val h = held.remove(item.key) ?: return@postDelayed
                    log("hold_expired", mapOf("alert_id" to item.alertId, "step" to item.step, "held_ms" to worker.wallNow() - t0))
                    post(h.item, h.withSound)
                }
                held[item.key] = Held(item, withSound, timer)
            }
        }
    }

    /** `reportShown(alert_id, step)` from the page: a held pair is dropped (the page owns it). */
    fun onReported(alertId: String, step: Int) {
        val h = held.remove("$alertId:$step") ?: return
        h.timer.cancel()
        log("shown_by_page", mapOf("alert_id" to alertId, "step" to step))
        dropped(h.item, h.withSound)
    }

    /** Activity stopped or signed out during a hold: post every held pair now (re-decided). */
    fun onPageState() {
        if (held.isEmpty()) return
        val p = page()
        if (p.activityVisible != false && p.signedIn != false) return
        val all = held.values.toList()
        held.clear()
        for (h in all) {
            h.timer.cancel()
            post(h.item, h.withSound)
        }
    }

    fun clear() {
        held.values.forEach { it.timer.cancel() }
        held.clear()
    }
}
