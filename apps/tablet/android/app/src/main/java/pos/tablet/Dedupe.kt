package pos.tablet

import org.json.JSONArray
import org.json.JSONObject

/** Persistence for a string value (alerts_plain in the app; a field in tests). */
interface Persisted {
    fun load(): String?
    fun save(value: String)
}

/**
 * 05b M-7: the `(alert_id, step)` keys this device has handled, oldest first, the last [capacity] kept
 * (Spec.DEDUPE_KEYS), persisted so a restart or reinstall-with-data never rings twice. Not thread-safe:
 * used on the service's single worker thread.
 */
class Dedupe(private val store: Persisted, private val capacity: Int = Spec.DEDUPE_KEYS) {
    private val keys = LinkedHashSet<String>()
    private var dirty = false

    init {
        try {
            val raw = store.load()
            if (raw != null) {
                val arr = JSONArray(raw)
                for (i in 0 until arr.length()) keys.add(arr.getString(i))
            }
        } catch (_: Exception) {
            keys.clear() // a corrupt value reads as empty, never a crash (M-22 spirit)
        }
        trim()
    }

    fun contains(key: String): Boolean = keys.contains(key)

    /** Records [key] in memory; [flush] persists. True if it was new. */
    fun add(key: String): Boolean {
        val added = keys.add(key)
        if (added) {
            trim()
            dirty = true
        }
        return added
    }

    fun flush() {
        if (!dirty) return
        store.save(JSONArray(keys.toList()).toString())
        dirty = false
    }

    val size: Int get() = keys.size

    private fun trim() {
        val it = keys.iterator()
        while (keys.size > capacity && it.hasNext()) {
            it.next()
            it.remove()
        }
    }
}

/**
 * 05b M-10 (input for A10): the open, unseen urgent alerts this service posted, alert_id → latest step,
 * persisted so a restart can re-arm the repeat without a first ring.
 */
class OpenUrgent(private val store: Persisted) {
    private val map = LinkedHashMap<String, Int>()

    init {
        try {
            val raw = store.load()
            if (raw != null) {
                val o = JSONObject(raw)
                for (k in o.keys()) map[k] = o.getInt(k)
            }
        } catch (_: Exception) {
            map.clear()
        }
    }

    fun snapshot(): Map<String, Int> = LinkedHashMap(map)
    fun contains(alertId: String): Boolean = map.containsKey(alertId)

    fun put(alertId: String, step: Int) { map[alertId] = step; save() }
    fun remove(alertId: String): Boolean = (map.remove(alertId) != null).also { if (it) save() }

    /** `alerts_open` is the complete open set: drop every id not in it. Returns the dropped ids. */
    fun retainOnly(openIds: Set<String>): List<String> {
        val gone = map.keys.filter { it !in openIds }
        if (gone.isNotEmpty()) { gone.forEach { map.remove(it) }; save() }
        return gone
    }

    private fun save() {
        val o = JSONObject()
        for ((k, v) in map) o.put(k, v)
        store.save(o.toString())
    }
}

/** What the intake does with one alert (one `alert` frame or one `alerts_open` row). */
enum class Decision {
    /** Known key: no notification, only the receipt (M-7). */
    DUPLICATE,
    /** Silent kind (01d `SILENT_KINDS`): no notification at all, receipt only (M-9). */
    SILENT_KIND,
    /** Posted without sound / vibration / FSI: `seen_by_me`, `from_business_day` (M-7, M-9, D-4), or an
     *  `alerts_open` row of a family that is never re-notified (01d §8.1: only urgent / action re-notify). */
    POST_SILENT,
    /** Posted with the family's sound. */
    POST_SOUND,
}

/** The Android side the intake drives (Notifier + socket in the app; fakes in tests). */
interface IntakeSink {
    fun isSilentKind(item: AlertItem): Boolean
    /** Posts one notification for [item]; [withSound] false = silent. */
    fun post(item: AlertItem, withSound: Boolean)
    /** Removes the alert's notification (closed, or gone from `alerts_open`). */
    fun cancel(alertId: String)
    /** Sends one text frame on the current socket; false if not queued. */
    fun send(text: String): Boolean
    fun log(ev: String, fields: Map<String, Any?>)
}

/**
 * 05b M-7, M-9, §2 receipts: the alert pipeline, pure. Per frame: decide and post each item, persist the
 * dedupe keys once, then send each `delivered` receipt (after the post and after the key is on disk). A
 * receipt goes once per key per socket ([onNewSocket] resets); the hub dedupes across sockets and the page.
 *
 * A10 / A11 hooks: [openUrgent] (open unseen urgent alerts posted with sound), [seenIds] in memory.
 */
class AlertIntake(
    private val dedupe: Dedupe,
    val openUrgent: OpenUrgent,
    private val sink: IntakeSink,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val receiptedThisSocket = HashSet<String>()

    fun onNewSocket() = receiptedThisSocket.clear()

    /** Returns the decision per item, in order (for tests and the log). */
    fun onFrame(frame: Frame, recvT: Long = clock()): List<Decision> = when (frame) {
        is Frame.Alert -> handle(listOf(frame.item), recvT)
        is Frame.AlertsOpen -> {
            val out = handle(frame.rows, recvT)
            val gone = openUrgent.retainOnly(frame.rows.map { it.alertId }.toSet())
            gone.forEach { sink.cancel(it) }
            out
        }
        is Frame.Seen -> { openUrgent.remove(frame.alertId); emptyList() }
        is Frame.Closed -> { openUrgent.remove(frame.alertId); sink.cancel(frame.alertId); emptyList() }
        else -> emptyList()
    }

    fun decide(item: AlertItem): Decision = when {
        dedupe.contains(item.key) -> Decision.DUPLICATE
        sink.isSilentKind(item) -> Decision.SILENT_KIND
        item.seenByMe || item.fromBusinessDay != null -> Decision.POST_SILENT
        item.via == "alerts_open" && item.family != "urgent" && item.family != "action" -> Decision.POST_SILENT
        else -> Decision.POST_SOUND
    }

    private fun handle(items: List<AlertItem>, recvT: Long): List<Decision> {
        val decisions = ArrayList<Decision>(items.size)
        for (item in items) {
            sink.log(
                "alert_received",
                mapOf(
                    "alert_id" to item.alertId, "step" to item.step, "raised_at" to item.raisedAt,
                    "family" to item.family, "kind" to item.kind, "via" to item.via, "recv_t" to recvT,
                ),
            )
            val d = decide(item)
            decisions.add(d)
            when (d) {
                Decision.DUPLICATE -> sink.log("duplicate_dropped", mapOf("alert_id" to item.alertId, "step" to item.step, "via" to item.via))
                Decision.SILENT_KIND -> sink.log("silent_kind", mapOf("alert_id" to item.alertId, "kind" to item.kind))
                Decision.POST_SILENT, Decision.POST_SOUND -> {
                    val sound = d == Decision.POST_SOUND
                    sink.post(item, sound)
                    sink.log("notified", mapOf("alert_id" to item.alertId, "step" to item.step, "sound" to sound))
                    if (item.family == "urgent" && sound) openUrgent.put(item.alertId, item.step)
                    else if (item.seenByMe) openUrgent.remove(item.alertId)
                }
            }
            dedupe.add(item.key)
        }
        dedupe.flush()
        for (item in items) {
            if (!receiptedThisSocket.add(item.key)) continue
            val receipt = JSONObject().put("type", "receipt").put("alert_id", item.alertId)
                .put("kind", "delivered").put("step", item.step)
            val queued = sink.send(receipt.toString())
            sink.log("receipt_sent", mapOf("alert_id" to item.alertId, "step" to item.step, "queued" to queued))
            if (!queued) receiptedThisSocket.remove(item.key)
        }
        return decisions
    }
}
