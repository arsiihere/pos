package pos.tablet

import android.app.Application
import android.os.Build
import android.os.Process

/** Installs [CrashLog] in every process (main and `:alerts`). Nothing else runs here. */
class PosApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashLog.install(this, processName())
    }

    private fun processName(): String =
        if (Build.VERSION.SDK_INT >= 28) Application.getProcessName()
        else try {
            java.io.File("/proc/${Process.myPid()}/cmdline").readText().trim { it <= ' ' || it == '\u0000' }
        } catch (_: Exception) { "unknown" }
}
