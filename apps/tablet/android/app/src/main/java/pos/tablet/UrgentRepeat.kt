package pos.tablet

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import org.json.JSONObject

/** Who plays an open urgent alert's repeat (05b O-15): the page if it reported the step, else the service. */
enum class RepeatOwner { PAGE, SERVICE }

/** The Android side of [UrgentRepeat] (the player + Notifier in the app; fakes in tests). */
interface RepeatSink {
    /** One urgent repeat sound on the alarm stream at [gain] (0..1). */
    fun play(gain: Float)
    /** Posts the alert's notification without sound (a take-over of a page-owned repeat, O-18). */
    fun postSilent(item: AlertItem)
    /** Removes the service's notification of the alert (hand-back to the page, O-18). */
    fun cancelNotification(alertId: String)
    fun log(ev: String, fields: Map<String, Any?>)
}

/**
 * 05b M-10, O-15, O-18 (01d §8.3 G1-14): the urgent repeat. Pure, with an injected [Worker] (clock + timers); call
 * everything on that worker. One entry per open urgent alert this device rang (service) or the page rang (page):
 *
 * - service-owned, unseen, before the escalation step: a sound every [Spec.URGENT_REPEAT_MS];
 * - seen (`alert_seen`, `seen_by_me`) or escalated: one reminder every [Spec.URGENT_REMINDER_MS] until closed;
 * - the escalation step (`escalation: true`) arriving before seen: one volume step-up ([STEP_UP_GAIN]) that stays
 *   for the alert until it closes (01d §8.3 as built), and the 2-min reminder;
 * - always-on device: no repeat at all (one sound per step = the notification's own);
 * - page-owned: nothing here until the page cannot ring (activity stopped or signed out) → the service takes over
 *   every page-owned open **unseen** alert, posts its notification silently and repeats, **no first ring**; when
 *   the activity is visible and signed in again, those taken over are handed back (timer off, notification removed).
 *
 * The set is persisted ([store]); [restore] after a process start re-arms every unseen-or-seen service entry and
 * takes over every page-owned unseen one (the page state is unknown, N-1), again without a first ring.
 */
class UrgentRepeat(
    private val store: Persisted,
    private val worker: Worker,
    private val sink: RepeatSink,
    private val alwaysOn: () -> Boolean,
) {
    companion object {
        const val BASE_GAIN = 0.8f
        const val STEP_UP_GAIN = 1.0f
    }

    private class Entry(
        var item: AlertItem,
        var owner: RepeatOwner,
        var seen: Boolean,
        var escalated: Boolean,
        /** A page-owned repeat the service took over (O-18): handed back when the page can ring again. */
        var takenOver: Boolean,
        var timer: Cancellable? = null,
    )

    private val entries = LinkedHashMap<String, Entry>()

    init { load() }

    // ------------------------------------------------------------------ inputs

    /** The service rang this step (its notification posted with sound): it owns the repeat from now. */
    fun onServicePosted(item: AlertItem) {
        val e = upsert(item)
        e.owner = RepeatOwner.SERVICE
        e.takenOver = false
        arm(e)
        save()
        sink.log("repeat_owner", mapOf("alert_id" to item.alertId, "step" to item.step, "owner" to "service", "escalated" to e.escalated))
    }

    /** The page reported this step within the hold (M-8): the page owns the repeat; the service stays silent. */
    fun onPageOwned(item: AlertItem) {
        val had = entries[item.alertId]
        val serviceNotification = had != null && had.owner == RepeatOwner.SERVICE
        val e = upsert(item)
        e.owner = RepeatOwner.PAGE
        e.takenOver = false
        disarm(e)
        if (serviceNotification) sink.cancelNotification(item.alertId) // M-8: one notification per alert
        save()
        sink.log("repeat_owner", mapOf("alert_id" to item.alertId, "step" to item.step, "owner" to "page", "escalated" to e.escalated))
    }

    /** `alert_seen`, or a row with `seen_by_me`: the 10 s repeat stops; the 2-min reminder goes on until closed. */
    fun onSeen(alertId: String) {
        val e = entries[alertId] ?: return
        if (e.seen) return
        e.seen = true
        if (e.owner == RepeatOwner.SERVICE) arm(e)
        save()
    }

    /** `alert_closed`: no more sound. */
    fun onClosed(alertId: String) {
        val e = entries.remove(alertId) ?: return
        disarm(e)
        save()
    }

    /** `alerts_open` is the complete open set: every other alert is closed. */
    fun retainOnly(openIds: Set<String>) {
        val gone = entries.keys.filter { it !in openIds }
        if (gone.isEmpty()) return
        gone.forEach { id -> entries.remove(id)?.let { disarm(it) } }
        save()
    }

    /**
     * O-18 / M-21: activity stopped (`activity_visible` false) or signed out → take over; visible and signed in →
     * hand back; anything unknown → no change.
     */
    fun onPageState(page: PageState) {
        when {
            page.activityVisible == false || page.signedIn == false -> takeOver()
            page.activityVisible == true && page.signedIn == true -> handBack()
        }
    }

    /** After a process start: re-arm without a first ring; page-owned unseen → taken over (page state unknown). */
    fun restore() {
        for (e in entries.values) {
            if (e.owner == RepeatOwner.PAGE && !e.seen) {
                takeOverOne(e, "restart")
            } else if (e.owner == RepeatOwner.SERVICE) {
                arm(e)
            }
        }
        save()
        sink.log("repeat_restored", mapOf("open" to entries.size))
    }

    // ------------------------------------------------------------------ read-only (tests, log, A14 install window)

    fun ownerOf(alertId: String): RepeatOwner? = entries[alertId]?.owner
    fun isArmed(alertId: String): Boolean = entries[alertId]?.timer != null
    fun openIds(): Set<String> = LinkedHashSet(entries.keys)
    fun openUnseenCount(): Int = entries.values.count { !it.seen }

    // ------------------------------------------------------------------ internals

    private fun upsert(item: AlertItem): Entry {
        val e = entries[item.alertId]
        if (e == null) {
            val n = Entry(item, RepeatOwner.SERVICE, seen = item.seenByMe, escalated = false, takenOver = false)
            if (item.escalation && !n.seen) n.escalated = true
            entries[item.alertId] = n
            return n
        }
        if (item.step >= e.item.step) e.item = item
        if (item.seenByMe) e.seen = true
        // 01d §8.3 G1-14c: the step-up only when the escalation step arrives before the person has seen the alert.
        if (item.escalation && !e.seen) e.escalated = true
        return e
    }

    private fun takeOver() {
        var changed = false
        for (e in entries.values) {
            if (e.owner == RepeatOwner.PAGE && !e.seen) { takeOverOne(e, "page_stopped"); changed = true }
        }
        if (changed) save()
    }

    private fun takeOverOne(e: Entry, why: String) {
        e.owner = RepeatOwner.SERVICE
        e.takenOver = true
        sink.postSilent(e.item)
        arm(e)
        sink.log("repeat_taken_over", mapOf("alert_id" to e.item.alertId, "step" to e.item.step, "why" to why))
    }

    private fun handBack() {
        var changed = false
        for (e in entries.values) {
            if (!e.takenOver) continue
            e.owner = RepeatOwner.PAGE
            e.takenOver = false
            disarm(e)
            sink.cancelNotification(e.item.alertId)
            sink.log("repeat_handed_back", mapOf("alert_id" to e.item.alertId))
            changed = true
        }
        if (changed) save()
    }

    private fun intervalOf(e: Entry): Long =
        if (!e.seen && !e.escalated) Spec.URGENT_REPEAT_MS else Spec.URGENT_REMINDER_MS

    private fun gainOf(e: Entry): Float = if (e.escalated) STEP_UP_GAIN else BASE_GAIN

    /** (Re)starts the timer from now; the step's own ring was the notification, so the first sound is one interval away. */
    private fun arm(e: Entry) {
        disarm(e)
        if (alwaysOn()) return // O-15 / G1-14d: one sound per step, then nothing
        val id = e.item.alertId
        e.timer = worker.postDelayed(intervalOf(e)) {
            val now = entries[id]
            if (now !== e || e.owner != RepeatOwner.SERVICE) return@postDelayed
            e.timer = null
            if (alwaysOn()) return@postDelayed
            sink.play(gainOf(e))
            sink.log("repeat_played", mapOf("alert_id" to id, "seen" to e.seen, "escalated" to e.escalated, "gain" to gainOf(e)))
            arm(e)
        }
    }

    private fun disarm(e: Entry) {
        e.timer?.cancel()
        e.timer = null
    }

    private fun save() {
        val o = JSONObject()
        for ((id, e) in entries) {
            o.put(
                id,
                JSONObject()
                    .put("item", RepeatItemJson.toJson(e.item))
                    .put("owner", e.owner.name)
                    .put("seen", e.seen)
                    .put("escalated", e.escalated)
                    .put("taken_over", e.takenOver),
            )
        }
        try { store.save(o.toString()) } catch (ex: Exception) { sink.log("repeat_save_failed", mapOf("error" to ex.toString())) }
    }

    private fun load() {
        try {
            val raw = store.load() ?: return
            val o = JSONObject(raw)
            for (id in o.keys()) {
                val v = o.optJSONObject(id) ?: continue
                val item = RepeatItemJson.fromJson(v.optJSONObject("item")) ?: continue
                val owner = if (v.optString("owner") == RepeatOwner.PAGE.name) RepeatOwner.PAGE else RepeatOwner.SERVICE
                entries[id] = Entry(item, owner, v.optBoolean("seen"), v.optBoolean("escalated"), v.optBoolean("taken_over"))
            }
        } catch (_: Exception) {
            entries.clear() // a corrupt value reads as empty, never a crash (M-22 spirit)
        }
    }
}

/** The fields of an [AlertItem] the repeat needs again after a restart (the silent take-over post). */
object RepeatItemJson {
    fun toJson(i: AlertItem): JSONObject = JSONObject()
        .put("alert_id", i.alertId)
        .put("step", i.step)
        .put("kind", i.kind)
        .put("family", i.family)
        .put("raised_at", i.raisedAt ?: JSONObject.NULL)
        .put("lock", i.lock)
        .put("outcome", i.outcome ?: JSONObject.NULL)
        .put("escalation", i.escalation)

    fun fromJson(o: JSONObject?): AlertItem? {
        if (o == null) return null
        val id = o.optString("alert_id", "").takeIf { it.isNotEmpty() } ?: return null
        val raised = o.opt("raised_at")
        val outcome = o.opt("outcome")
        return AlertItem(
            alertId = id,
            step = o.optInt("step", 0),
            kind = o.optString("kind", ""),
            family = o.optString("family", "urgent"),
            raisedAt = if (raised is Number) raised.toLong() else null,
            lock = o.optJSONObject("lock") ?: JSONObject(),
            outcome = if (outcome is String) outcome else null,
            seenByMe = false,
            fromBusinessDay = null,
            via = "alert",
            escalation = o.optBoolean("escalation", false),
        )
    }
}

/**
 * The thin Android player: the default alarm sound on the **alarm stream** (`USAGE_ALARM`), cut after
 * [MAX_PLAY_MS]. A `MediaPlayer`, not `SoundPool`: the app bundles no sound file and `SoundPool` cannot load the
 * system alarm's `content://` URI. One sound at a time.
 */
class AlarmPlayer(private val ctx: Context, private val worker: Worker) {
    companion object { private const val MAX_PLAY_MS = 3_000L }

    private var current: MediaPlayer? = null
    private var stopTimer: Cancellable? = null

    fun play(gain: Float) {
        stop()
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION) ?: return
            val mp = MediaPlayer()
            mp.setAudioAttributes(
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
            )
            mp.setDataSource(ctx, uri)
            mp.isLooping = false
            mp.setVolume(gain, gain)
            mp.setOnCompletionListener { worker.post { if (current === it) stop() } }
            mp.prepare()
            mp.start()
            current = mp
            stopTimer = worker.postDelayed(MAX_PLAY_MS) { if (current === mp) stop() }
        } catch (e: Exception) {
            AlertLog.ev("repeat_play_failed", mapOf("error" to e.toString()))
            stop()
        }
    }

    fun stop() {
        stopTimer?.cancel()
        stopTimer = null
        val mp = current ?: return
        current = null
        try { mp.stop() } catch (_: Exception) {}
        try { mp.release() } catch (_: Exception) {}
    }
}

/** `alerts_plain` key `urgent_repeat` (M-10's persisted open urgent set with its owner; `:alerts` owns the store). */
fun urgentRepeatStore(ctx: Context): Persisted = object : Persisted {
    private fun prefs() = ctx.applicationContext.getSharedPreferences(Stores.ALERTS_PLAIN, Context.MODE_PRIVATE)
    override fun load(): String? = prefs().getString("urgent_repeat", null)
    override fun save(value: String) { prefs().edit().putString("urgent_repeat", value).commit() }
}
