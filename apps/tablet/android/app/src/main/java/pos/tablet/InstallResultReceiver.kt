package pos.tablet

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.IntentCompat
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * 05b M-15 Android glue for [UpdateClient] in `:alerts`: the one client per process, the PackageInstaller
 * session, the "Update ready" notification and the session status receiver.
 */
object Updates {
    @Volatile private var instance: UpdateClient? = null

    /** §4.2 `state.update_ready` (false until the client exists in this process). */
    val updateReady: Boolean get() = instance?.updateReady ?: false

    fun client(ctx: Context): UpdateClient {
        instance?.let { return it }
        return synchronized(this) { instance ?: create(ctx.applicationContext).also { instance = it } }
    }

    private fun create(app: Context): UpdateClient {
        val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "pos-update").apply { isDaemon = true } }
        val http = UpdateHttp({ AlertsStore.hubOrigin(app) }, { AlertsStore.token(app) }, BuildConfig.VERSION_NAME)
        val io = object : UpdateIo {
            override fun latest() = http.latest()
            override fun download(release: Release, dest: File) = http.download(release, dest)
            override fun install(apk: File, release: Release, deviceOwner: Boolean) = ApkInstaller.install(app, apk)
        }
        val env = object : UpdateEnv {
            override fun now() = System.currentTimeMillis()
            override fun signedIn() = AlertsMemory.signedIn
            override fun openUnseenUrgent(): Int =
                try { AlertsStore.openUrgentStore(app).load()?.let { JSONObject(it).length() } ?: 0 } catch (_: Exception) { 0 }
            override fun deviceOwner(): Boolean =
                try { app.getSystemService(DevicePolicyManager::class.java)?.isDeviceOwnerApp(app.packageName) ?: false } catch (_: Exception) { false }
            override fun lastCheck() = AlertsStore.lastUpdateCheck(app)
            override fun setLastCheck(t: Long) = AlertsStore.setLastUpdateCheck(app, t)
        }
        return UpdateClient(
            currentCode = BuildConfig.VERSION_CODE.toLong(),
            dir = File(app.noBackupFilesDir, "apk"),
            io = io,
            env = env,
            exec = exec,
            onStateChange = { s ->
                if (s == UpdateState.NONE) UpdateNotice.cancel(app)
                val svc = AlertService.instance
                IpcReply.state(app, AlertsStore.paired(app), svc?.alertSocket ?: "down", svc?.bindingRouteUntil)
            },
            log = { ev, fields -> AlertLog.ev(ev, fields) },
        )
    }
}

/**
 * PackageInstaller session (API 21+, no FileProvider, §7). Device owner → installs silently; otherwise the
 * session answers STATUS_PENDING_USER_ACTION and [InstallResultReceiver] posts "Update ready" with the prompt.
 */
object ApkInstaller {
    const val ACTION_RESULT = "pos.tablet.INSTALL_RESULT"
    private const val REQUEST_CODE = 43

    fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        for (s in installer.mySessions) {
            try { installer.abandonSession(s.sessionId) } catch (_: Exception) {}
        }
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        params.setSize(apk.length())
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("base.apk", 0, apk.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
            val status = PendingIntent.getBroadcast(
                ctx, REQUEST_CODE,
                Intent(ctx, InstallResultReceiver::class.java).setAction(ACTION_RESULT).setPackage(ctx.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or mutable, // the installer fills in EXTRA_STATUS (explicit intent)
            )
            session.commit(status.intentSender)
        }
    }
}

/** M-15: "Update ready" (non-device-owner) — a tap opens the system install prompt. */
object UpdateNotice {
    private const val ID = 3

    fun post(ctx: Context, confirm: Intent) {
        try {
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val pi = PendingIntent.getActivity(ctx, ID, confirm, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = NotificationCompat.Builder(ctx, Channels.INFO)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Update ready")
                .setContentText("Tap to install the new version of the app.")
                .setSilent(true)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build()
            ctx.getSystemService(NotificationManager::class.java)?.notify(ID, n)
        } catch (e: Exception) {
            AlertLog.ev("update_notice_failed", mapOf("error" to e.toString()))
        }
    }

    fun cancel(ctx: Context) {
        try { ctx.getSystemService(NotificationManager::class.java)?.cancel(ID) } catch (_: Exception) {}
    }
}

/** The PackageInstaller session status (process `:alerts`, not exported). */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ApkInstaller.ACTION_RESULT) return
        val ctx = context.applicationContext
        AlertLog.init(ctx.filesDir)
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        val result = when (status) {
            PackageInstaller.STATUS_SUCCESS -> {
                UpdateNotice.cancel(ctx)
                InstallResult.SUCCESS
            }
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                if (confirm != null) UpdateNotice.post(ctx, confirm)
                InstallResult.PENDING_USER_ACTION
            }
            else -> InstallResult.FAILED
        }
        Updates.client(ctx).onInstallResult(result, "status=$status ${message ?: ""}".trim())
    }
}
