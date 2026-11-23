package pos.tablet

import android.content.Context
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * 05b M-19 aid (owner, 2026-11-23: first device run crashed on open, no USB for logcat). Every process writes
 * its uncaught exception to files/crash/<process>.txt, then the default handler runs as before. The debug build
 * shows the newest report on the next launch ([CrashActivity]) so it can be read without adb.
 */
object CrashLog {
    private const val DIR = "crash"

    fun install(ctx: Context, process: String) {
        val app = ctx.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            try {
                val dir = File(app.filesDir, DIR).apply { mkdirs() }
                File(dir, "${safe(process)}.txt").writeText(
                    format(e, System.currentTimeMillis(), process, thread.name, BuildConfig.VERSION_NAME,
                        Build.VERSION.SDK_INT, "${Build.MANUFACTURER} ${Build.MODEL}"),
                )
            } catch (_: Throwable) { /* never mask the real crash */ }
            previous?.uncaughtException(thread, e)
        }
    }

    /** The newest report, or null. */
    fun pending(ctx: Context): String? =
        File(ctx.filesDir, DIR).listFiles()?.filter { it.isFile }?.maxByOrNull { it.lastModified() }?.let {
            try { it.readText() } catch (_: Exception) { null }
        }

    fun clear(ctx: Context) {
        File(ctx.filesDir, DIR).listFiles()?.forEach { it.delete() }
    }

    fun safe(process: String): String = process.replace(Regex("[^A-Za-z0-9._-]"), "_")

    fun format(e: Throwable, atMs: Long, process: String, thread: String, version: String, sdk: Int, device: String): String {
        val sw = StringWriter()
        e.printStackTrace(PrintWriter(sw))
        return buildString {
            append("Arif POS crash report\n")
            append("time_ms=").append(atMs).append('\n')
            append("process=").append(process).append(" thread=").append(thread).append('\n')
            append("app=").append(version).append(" sdk=").append(sdk).append(" device=").append(device).append('\n')
            append('\n').append(sw.toString())
        }
    }
}
