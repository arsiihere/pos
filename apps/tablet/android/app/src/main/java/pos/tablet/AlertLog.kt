package pos.tablet

import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileWriter

/**
 * JSONL file with size rotation: when the current file would pass [maxBytes] it becomes `<name>.1`
 * (replacing the older one), so at most two files exist (05b M-19).
 */
class JsonlFile(dir: File, name: String, private val maxBytes: Long) {
    val current = File(dir, name)
    val previous = File(dir, "$name.1")

    @Synchronized
    fun append(line: String) {
        val bytes = line.toByteArray(Charsets.UTF_8).size + 1
        if (current.exists() && current.length() + bytes > maxBytes) {
            previous.delete()
            if (!current.renameTo(previous)) current.delete()
        }
        FileWriter(current, true).use { it.write(line); it.write("\n") }
    }
}

/**
 * 05b M-19: the `:alerts` native log, JSONL in filesDir (`alerts-log.jsonl`, rotated at Spec.LOG_ROTATE_BYTES,
 * 2 files), read with `adb exec-out run-as <pkg> cat files/alerts-log.jsonl`; uploaded nowhere.
 * Every line: `{ t: wall ms, elapsed: elapsedRealtime ms, ev, ...fields }`. Event names as the spike:
 * socket_open, auth_sent, first_frame, socket_closed{code,reason}, reconnect_scheduled, network_available,
 * alert_received{alert_id,step,raised_at,via,recv_t}, notified, receipt_sent, duplicate_dropped,
 * service_start{reason}, heartbeat. Never a token or a frame body.
 */
object AlertLog {
    const val FILE = "alerts-log.jsonl"
    @Volatile private var file: JsonlFile? = null

    fun init(filesDir: File) {
        if (file == null) synchronized(this) { if (file == null) file = JsonlFile(filesDir, FILE, Spec.LOG_ROTATE_BYTES) }
    }

    fun ev(name: String, fields: Map<String, Any?> = emptyMap()) {
        val line = try {
            val o = JSONObject()
            o.put("t", System.currentTimeMillis())
            o.put("elapsed", try { SystemClock.elapsedRealtime() } catch (_: Throwable) { 0L })
            o.put("ev", name)
            for ((k, v) in fields) o.put(k, v ?: JSONObject.NULL)
            o.toString()
        } catch (_: Throwable) {
            return
        }
        try { Log.i("PosAlerts", line) } catch (_: Throwable) {}
        val f = file ?: return
        try { f.append(line) } catch (e: Throwable) {
            try { Log.e("PosAlerts", "log write failed", e) } catch (_: Throwable) {}
        }
    }
}
