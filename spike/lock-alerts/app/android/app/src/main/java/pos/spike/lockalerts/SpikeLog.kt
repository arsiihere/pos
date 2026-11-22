package pos.spike.lockalerts

import android.content.Context
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileWriter

/**
 * [spike lock-alerts] Device-side JSONL log — the source of truth for latency.
 * Pull: adb exec-out run-as pos.spike.lockalerts cat files/spike-log.jsonl > spike-log.jsonl
 * Every line: { t: wall ms, elapsed: elapsedRealtime ms, ev: <name>, ...fields }.
 */
object SpikeLog {
    private const val FILE = "spike-log.jsonl"
    private var file: File? = null

    fun init(ctx: Context) {
        if (file == null) file = File(ctx.applicationContext.filesDir, FILE)
    }

    fun path(ctx: Context): String = File(ctx.applicationContext.filesDir, FILE).absolutePath

    @Synchronized
    fun ev(name: String, fields: Map<String, Any?> = emptyMap()) {
        val o = JSONObject()
        o.put("t", System.currentTimeMillis())
        o.put("elapsed", SystemClock.elapsedRealtime())
        o.put("ev", name)
        for ((k, v) in fields) o.put(k, v ?: JSONObject.NULL)
        val line = o.toString()
        Log.i("PosSpike", line)
        val f = file ?: return
        try {
            FileWriter(f, true).use { it.write(line); it.write("\n") }
        } catch (e: Exception) {
            Log.e("PosSpike", "log write failed", e)
        }
    }

    @Synchronized
    fun clear(ctx: Context) {
        File(ctx.applicationContext.filesDir, FILE).delete()
    }

    @Synchronized
    fun tail(ctx: Context, lines: Int): List<String> {
        val f = File(ctx.applicationContext.filesDir, FILE)
        if (!f.exists()) return emptyList()
        val all = f.readLines()
        return all.takeLast(lines)
    }
}
