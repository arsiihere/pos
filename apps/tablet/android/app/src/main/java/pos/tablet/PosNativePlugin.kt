package pos.tablet

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** 05b §4.2 skeleton (lane 2 replaces): the guarded PosNative bridge. */
@CapacitorPlugin(name = "PosNative")
class PosNativePlugin : Plugin() {
    @PluginMethod
    fun info(call: PluginCall) {
        val r = JSObject()
        r.put("native_api", Spec.NATIVE_API)
        r.put("version_code", BuildConfig.VERSION_CODE)
        r.put("version_name", BuildConfig.VERSION_NAME)
        r.put("device_owner", false)
        call.resolve(r)
    }
}
