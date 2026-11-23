package pos.tablet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * 05b M-9 channels and the alert / status notifications (01d §8.2). One notification per alert (tag =
 * alert_id), re-posted for each new step; title "POS", text from [LockText.render].
 * A10–A12 hooks: [onUrgentPosted] (FSI / repeat), the content intent carries `alert_id` for the tap (M-12).
 */
class Notifier(private val ctx: Context) {
    companion object {
        const val STATUS_ID = 1
        private const val ALERT_ID = 2
        @Volatile private var channelsCreated = false

        /** LockText.soundFamily → channel. */
        fun channelFor(soundFamily: String): String = when (soundFamily) {
            "urgent" -> Channels.URGENT
            "action" -> Channels.ACTION
            "result_approved", "result_rejected" -> Channels.RESULT
            else -> Channels.INFO
        }
    }

    /** A10 / A11: called after an urgent alert is posted with sound (FSI, repeat ownership). */
    @Volatile var onUrgentPosted: ((AlertItem, NotificationCompat.Builder) -> Unit)? = null

    private val nm: NotificationManager get() = ctx.getSystemService(NotificationManager::class.java)

    fun createChannels() {
        if (channelsCreated || Build.VERSION.SDK_INT < 26) return
        val nm = nm
        nm.createNotificationChannel(
            NotificationChannel(Channels.STATUS, "Alert connection", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
        fun alertChannel(id: String, name: String, usage: Int, sound: android.net.Uri?) =
            NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                enableVibration(true)
                vibrationPattern = if (id == Channels.URGENT) longArrayOf(0, 800, 200, 800) else longArrayOf(0, 300, 150, 300)
                setSound(
                    sound,
                    AudioAttributes.Builder().setUsage(usage).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                )
            }
        val alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val note = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        nm.createNotificationChannel(alertChannel(Channels.URGENT, "Urgent alerts", AudioAttributes.USAGE_ALARM, alarm))
        nm.createNotificationChannel(alertChannel(Channels.ACTION, "Action alerts", AudioAttributes.USAGE_NOTIFICATION, note))
        nm.createNotificationChannel(alertChannel(Channels.INFO, "Info alerts", AudioAttributes.USAGE_NOTIFICATION, note))
        nm.createNotificationChannel(alertChannel(Channels.RESULT, "Request results", AudioAttributes.USAGE_NOTIFICATION, note))
        channelsCreated = true
    }

    fun post(item: AlertItem, withSound: Boolean, language: String) {
        val lock = item.lockForText()
        val text = try { LockText.render(ctx, item.kind, lock, language) } catch (e: Exception) { item.kind }
        val sound = try { LockText.soundFamily(ctx, item.kind, item.family, lock) } catch (e: Exception) { item.family }
        val urgent = sound == "urgent"
        // LockText returns "none" for a silent kind or a withdrawn request_result (the page plays nothing): post without sound.
        val noSound = sound == "none"
        val tap = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setClassName(ctx, "pos.tablet.MainActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("alert_id", item.alertId)
        val pi = PendingIntent.getActivity(
            ctx, item.alertId.hashCode(), tap, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val b = NotificationCompat.Builder(ctx, channelFor(sound))
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("POS")
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(if (urgent) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setSilent(!withSound || noSound)
        item.raisedAt?.let { b.setWhen(it).setShowWhen(true) }
        // 05b A12: M-11 full-screen intent, urgent with sound only (the FSI activity runs in the main process).
        if (urgent && withSound) b.setFullScreenIntent(FullScreenAlertActivity.pendingIntent(ctx, item.alertId, text), true)
        if (urgent && withSound) onUrgentPosted?.invoke(item, b) // A10–A12: FSI / repeat attach here, before notify
        try {
            nm.notify(item.alertId, ALERT_ID, b.build())
        } catch (e: Exception) {
            AlertLog.ev("notify_failed", mapOf("alert_id" to item.alertId, "error" to e.toString()))
        }
    }

    fun cancel(alertId: String) {
        try { nm.cancel(alertId, ALERT_ID) } catch (_: Exception) {}
    }

    fun statusNotification(text: String): Notification {
        val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        val pi = open?.let { PendingIntent.getActivity(ctx, 1, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
        return NotificationCompat.Builder(ctx, Channels.STATUS)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("POS alerts")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .apply { if (pi != null) setContentIntent(pi) }
            .build()
    }

    fun updateStatus(text: String) {
        try { nm.notify(STATUS_ID, statusNotification(text)) } catch (_: Exception) {}
    }
}
