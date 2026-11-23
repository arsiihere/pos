package pos.tablet

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/**
 * 05b M-1 skeleton (lane 1 replaces): deferred load, probe off the main thread, origin-only server.url
 * + startPath, main-frame error handling, render-process recovery.
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(PosNativePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
