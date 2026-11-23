package pos.tablet

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

/** One row of `GET /app/android/latest` (`{ data: { version_name, version_code, sha256, staged_device_id } }`). */
data class Release(val versionName: String, val versionCode: Long, val sha256: String)

/** §4.2 `checkForUpdate()` states. */
enum class UpdateState(val wire: String) { NONE("none"), DOWNLOADING("downloading"), READY("ready"), INSTALLING("installing") }

/**
 * 05b M-15 + D-3 pure decisions (test 16).
 */
object UpdatePolicy {
    fun isNewer(latestCode: Long, currentCode: Long): Boolean = latestCode > currentCode

    /**
     * D-3 install window: no session signed in AND no open unseen urgent alert. `signedIn == null` = unknown
     * (the page has not called setSession since `:alerts` started, N-1) → closed.
     */
    fun windowOpen(signedIn: Boolean?, openUnseenUrgent: Int): Boolean = signedIn == false && openUnseenUrgent == 0

    /** Hourly check (Spec.UPDATE_CHECK_MS); a clock that went backwards counts as due. */
    fun due(now: Long, lastCheck: Long): Boolean = lastCheck <= 0 || now < lastCheck || now - lastCheck >= Spec.UPDATE_CHECK_MS

    /** The hub's `sha256` is lowercase hex (apps/hub app-update cli); an empty one never matches. */
    fun shaMatches(expected: String, actual: String): Boolean = expected.isNotEmpty() && expected.equals(actual, ignoreCase = true)

    fun sha256Hex(input: InputStream): String {
        val md = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            md.update(buf, 0, n)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    fun sha256Hex(file: File): String = file.inputStream().use { sha256Hex(it) }

    /** `{ data: {…} }` → [Release], or null for any other body. */
    fun parseLatest(body: String?): Release? {
        if (body.isNullOrEmpty()) return null
        return try {
            val d = JSONObject(body).optJSONObject("data") ?: return null
            val code = d.optLong("version_code", 0L)
            val sha = d.optString("sha256", "")
            if (code <= 0 || sha.isEmpty()) null else Release(d.optString("version_name", ""), code, sha)
        } catch (_: Exception) {
            null
        }
    }

    /** Several install attempts: device owner retries every tick; a prompt the user dismissed comes back hourly. */
    fun mayAttemptInstall(deviceOwner: Boolean, now: Long, lastAttempt: Long): Boolean =
        deviceOwner || lastAttempt <= 0 || now < lastAttempt || now - lastAttempt >= Spec.UPDATE_CHECK_MS
}

/** Outcome of the `latest` call. */
sealed class Latest {
    data class Found(val release: Release) : Latest()
    /** 404 `ROUTE_NOT_FOUND`: no release on the hub. */
    object NoRelease : Latest()
    data class Failed(val why: String) : Latest()
}

/** The I/O the client needs; [UpdateHttp] + the PackageInstaller glue in production, fakes in tests. */
interface UpdateIo {
    fun latest(): Latest
    /** Downloads `<version_code>.apk` into [dest]; false on any failure (a partial file is deleted). */
    fun download(release: Release, dest: File): Boolean
    /** Starts the install session; its result comes back through [UpdateClient.onInstallResult]. */
    fun install(apk: File, release: Release, deviceOwner: Boolean)
}

/** What the install window and the schedule read. */
interface UpdateEnv {
    fun now(): Long
    fun signedIn(): Boolean?
    fun openUnseenUrgent(): Int
    fun deviceOwner(): Boolean
    fun lastCheck(): Long
    fun setLastCheck(t: Long)
}

enum class InstallResult { SUCCESS, PENDING_USER_ACTION, FAILED }

/**
 * 05b M-15: the APK update client in `:alerts`. All work runs on [exec] (one thread in production), so the
 * state below has a single writer. Checks: after each reconnect (first frame), on `4426`, on CHECK_FOR_UPDATE,
 * and hourly (watchdog tick). A higher `version_code` is downloaded into [dir] (app-private, no FileProvider,
 * §7) and its `sha256` verified; it installs only inside the D-3 window.
 */
class UpdateClient(
    private val currentCode: Long,
    private val dir: File,
    private val io: UpdateIo,
    private val env: UpdateEnv,
    private val exec: Executor,
    private val onStateChange: (UpdateState) -> Unit = {},
    private val log: (String, Map<String, Any?>) -> Unit = { _, _ -> },
) {
    @Volatile var state: UpdateState = UpdateState.NONE
        private set
    @Volatile var ready: Release? = null
        private set
    private var lastInstallAttempt = 0L

    val updateReady: Boolean get() = state == UpdateState.READY || state == UpdateState.INSTALLING

    init {
        // After an install (or a refused one) drop what can no longer be newer, and any partial download.
        exec.execute {
            try {
                dir.listFiles()?.forEach { f ->
                    val code = f.name.removeSuffix(".apk").toLongOrNull()
                    if (!f.name.endsWith(".apk") || code == null || !UpdatePolicy.isNewer(code, currentCode)) f.delete()
                }
            } catch (_: Exception) {}
        }
    }

    fun apkFile(code: Long): File = File(dir, "$code.apk")

    /** Queue a check (reconnect, 4426, watchdog when due). */
    fun checkAsync(reason: String) = exec.execute { check(reason) }

    /** Watchdog tick: hourly check when due, else just retry the install if the window opened. */
    fun tickAsync() = exec.execute {
        if (UpdatePolicy.due(env.now(), env.lastCheck())) check("hourly") else tryInstall()
    }

    /** setSession / alert closed: the window may have opened. */
    fun windowMayHaveOpened() = exec.execute { tryInstall() }

    /** CHECK_FOR_UPDATE: runs the check now (on [exec]) and answers the state at that point. */
    fun checkNow(reason: String, done: (UpdateState) -> Unit) = exec.execute { check(reason); done(state) }

    fun onInstallResult(result: InstallResult, message: String?) = exec.execute {
        log("update_install_result", mapOf("result" to result.name, "message" to message))
        when (result) {
            // The process is replaced; MY_PACKAGE_REPLACED restarts the service (M-6).
            InstallResult.SUCCESS -> Unit
            // The "Update ready" notification carries the system prompt; the state stays ready until then.
            InstallResult.PENDING_USER_ACTION -> setState(UpdateState.READY)
            InstallResult.FAILED -> setState(if (ready != null) UpdateState.READY else UpdateState.NONE)
        }
    }

    // ------------------------------------------------------------------ on exec

    private fun check(reason: String) {
        if (state == UpdateState.DOWNLOADING || state == UpdateState.INSTALLING) {
            log("update_check_skipped", mapOf("reason" to reason, "state" to state.wire))
            return
        }
        env.setLastCheck(env.now())
        when (val l = io.latest()) {
            is Latest.Failed -> log("update_check_failed", mapOf("reason" to reason, "why" to l.why))
            is Latest.NoRelease -> {
                log("update_check", mapOf("reason" to reason, "latest" to null))
                drop()
            }
            is Latest.Found -> {
                val r = l.release
                log("update_check", mapOf("reason" to reason, "latest" to r.versionCode, "current" to currentCode))
                if (!UpdatePolicy.isNewer(r.versionCode, currentCode)) { drop(); return }
                if (ready?.versionCode == r.versionCode && ready?.sha256 == r.sha256 && apkFile(r.versionCode).exists()) {
                    tryInstall()
                    return
                }
                // The download is the next task on [exec], so a CHECK_FOR_UPDATE answers 'downloading' first.
                ready = null
                setState(UpdateState.DOWNLOADING)
                exec.execute { fetch(r) }
            }
        }
    }

    private fun fetch(r: Release) {
        val f = apkFile(r.versionCode)
        val ok = try {
            dir.mkdirs()
            (f.exists() && UpdatePolicy.shaMatches(r.sha256, UpdatePolicy.sha256Hex(f))) ||
                (io.download(r, f) && verify(r, f))
        } catch (e: Exception) {
            log("update_download_failed", mapOf("error" to e.toString()))
            false
        }
        if (!ok) {
            f.delete()
            setState(UpdateState.NONE)
            return
        }
        cleanup(keep = f)
        ready = r
        log("update_ready", mapOf("version_code" to r.versionCode))
        setState(UpdateState.READY)
        tryInstall()
    }

    private fun verify(r: Release, f: File): Boolean {
        val actual = UpdatePolicy.sha256Hex(f)
        val ok = UpdatePolicy.shaMatches(r.sha256, actual)
        if (!ok) log("update_sha256_mismatch", mapOf("version_code" to r.versionCode, "expected" to r.sha256, "actual" to actual))
        return ok
    }

    private fun tryInstall() {
        val r = ready ?: return
        if (state != UpdateState.READY) return
        val signedIn = env.signedIn()
        val urgent = env.openUnseenUrgent()
        if (!UpdatePolicy.windowOpen(signedIn, urgent)) {
            log("update_window_closed", mapOf("signed_in" to signedIn, "open_unseen_urgent" to urgent))
            return
        }
        val owner = env.deviceOwner()
        val now = env.now()
        if (!UpdatePolicy.mayAttemptInstall(owner, now, lastInstallAttempt)) return
        val f = apkFile(r.versionCode)
        if (!f.exists()) { ready = null; setState(UpdateState.NONE); return }
        lastInstallAttempt = now
        setState(UpdateState.INSTALLING)
        log("update_install", mapOf("version_code" to r.versionCode, "device_owner" to owner))
        try {
            io.install(f, r, owner)
        } catch (e: Exception) {
            log("update_install_failed", mapOf("error" to e.toString()))
            setState(UpdateState.READY)
        }
    }

    /** The hub has nothing newer (or the staged build was withdrawn): forget a downloaded one. */
    private fun drop() {
        if (ready == null && state == UpdateState.NONE) return
        ready = null
        cleanup(keep = null)
        setState(UpdateState.NONE)
    }

    private fun cleanup(keep: File?) {
        try {
            dir.listFiles()?.forEach { if (it != keep) it.delete() }
        } catch (_: Exception) {}
    }

    private fun setState(s: UpdateState) {
        if (s == state) return
        state = s
        onStateChange(s)
    }
}

/**
 * The thin HTTP part: `GET <hub>/app/android/latest` and `GET <hub>/app/android/<version_code>.apk`, both
 * with `Authorization: Bearer <device token>` and `X-Client-Version: <version_name>` (H-3). Blocking.
 */
class UpdateHttp(
    private val origin: () -> String?,
    private val token: () -> String?,
    private val clientVersion: String,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build(),
) {
    private fun request(path: String): Request? {
        val o = origin()?.trimEnd('/')
        val t = token()
        if (o.isNullOrEmpty() || t.isNullOrEmpty()) return null
        return try {
            Request.Builder().url(o + path)
                .header("Authorization", "Bearer $t")
                .header("X-Client-Version", clientVersion)
                .get().build()
        } catch (_: Exception) {
            null
        }
    }

    private val latestClient: OkHttpClient by lazy {
        client.newBuilder().readTimeout(3, TimeUnit.SECONDS).callTimeout(5, TimeUnit.SECONDS).build()
    }

    fun latest(): Latest {
        val req = request("/app/android/latest") ?: return Latest.Failed("NOT_PAIRED")
        return try {
            latestClient.newCall(req).execute().use { resp ->
                val body = try { resp.body?.string() } catch (_: Exception) { null }
                when {
                    resp.code == 200 -> UpdatePolicy.parseLatest(body)?.let { Latest.Found(it) } ?: Latest.Failed("BAD_BODY")
                    resp.code == 404 && CloseCodes.errorCode(body) == "ROUTE_NOT_FOUND" -> Latest.NoRelease
                    else -> Latest.Failed(CloseCodes.errorCode(body) ?: resp.code.toString())
                }
            }
        } catch (e: Exception) {
            Latest.Failed("UNREACHABLE")
        }
    }

    fun download(release: Release, dest: File): Boolean {
        val req = request("/app/android/${release.versionCode}.apk") ?: return false
        val tmp = File(dest.parentFile, dest.name + ".part")
        return try {
            client.newCall(req).execute().use { resp ->
                val body = resp.body
                if (resp.code != 200 || body == null) return false
                tmp.outputStream().use { out -> body.byteStream().copyTo(out) }
            }
            if (dest.exists()) dest.delete()
            tmp.renameTo(dest)
        } catch (_: Exception) {
            false
        } finally {
            tmp.delete()
        }
    }
}
