package pos.tablet

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log

/**
 * 05b M-17 (plan A15): thin DevicePolicyManager glue that runs [LockTaskPolicy]'s actions. Every call is
 * idempotent, so it runs at every `onResume` and when `setDeviceContext` changes `lock_task`. A failing call is
 * logged and the rest still run (the unit is still alerting; health shows `lock_task_state`).
 */
object DeviceOwner {
    private const val TAG = "PosDeviceOwner"
    private const val HOME_ALIAS = "pos.tablet.HomeAlias" // manifest activity-alias (namespace pos.tablet)

    fun isDeviceOwner(a: Activity): Boolean =
        a.getSystemService(DevicePolicyManager::class.java)?.isDeviceOwnerApp(a.packageName) ?: false

    fun apply(a: Activity, lockTask: Boolean, resumed: Boolean) {
        val dpm = a.getSystemService(DevicePolicyManager::class.java) ?: return
        val owner = dpm.isDeviceOwnerApp(a.packageName)
        val state = a.getSystemService(ActivityManager::class.java)?.lockTaskModeState ?: MainHealth.ActivityManagerModes.NONE
        val actions = LockTaskPolicy.decide(owner, lockTask, state, Build.VERSION.SDK_INT, resumed)
        if (actions.isEmpty()) return
        Log.i(TAG, "lock_task=$lockTask state=$state → $actions")
        val admin = ComponentName(a, PosDeviceAdmin::class.java)
        val alias = ComponentName(a.packageName, HOME_ALIAS)
        for (action in actions) {
            try {
                run(a, dpm, admin, alias, action)
            } catch (e: Exception) { // SecurityException / IllegalStateException on an odd OEM build
                Log.w(TAG, "$action failed: $e")
            }
        }
    }

    private fun run(a: Activity, dpm: DevicePolicyManager, admin: ComponentName, alias: ComponentName, action: LockTaskPolicy.Action) {
        when (action) {
            LockTaskPolicy.Action.GRANT_POST_NOTIFICATIONS -> if (Build.VERSION.SDK_INT >= 33) {
                dpm.setPermissionGrantState(admin, a.packageName, android.Manifest.permission.POST_NOTIFICATIONS,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
            }
            LockTaskPolicy.Action.SET_LOCK_TASK_PACKAGES -> dpm.setLockTaskPackages(admin, arrayOf(a.packageName))
            LockTaskPolicy.Action.SET_LOCK_TASK_FEATURES -> if (Build.VERSION.SDK_INT >= 28) {
                dpm.setLockTaskFeatures(admin, LockTaskPolicy.FEATURES)
            }
            LockTaskPolicy.Action.ENABLE_HOME_ALIAS -> setAlias(a, alias, PackageManager.COMPONENT_ENABLED_STATE_ENABLED)
            LockTaskPolicy.Action.SET_PREFERRED_HOME -> {
                // clear first, so repeated resumes never stack duplicate entries
                dpm.clearPackagePersistentPreferredActivities(admin, a.packageName)
                val filter = IntentFilter(Intent.ACTION_MAIN).apply {
                    addCategory(Intent.CATEGORY_HOME)
                    addCategory(Intent.CATEGORY_DEFAULT)
                }
                dpm.addPersistentPreferredActivity(admin, filter, alias)
            }
            LockTaskPolicy.Action.START_LOCK_TASK -> a.startLockTask()
            LockTaskPolicy.Action.STOP_LOCK_TASK -> a.stopLockTask()
            LockTaskPolicy.Action.CLEAR_PREFERRED_HOME -> dpm.clearPackagePersistentPreferredActivities(admin, a.packageName)
            LockTaskPolicy.Action.DISABLE_HOME_ALIAS -> setAlias(a, alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED)
            LockTaskPolicy.Action.CLEAR_LOCK_TASK_PACKAGES -> dpm.setLockTaskPackages(admin, arrayOf())
        }
    }

    private fun setAlias(a: Activity, alias: ComponentName, state: Int) {
        val pm = a.packageManager
        if (pm.getComponentEnabledSetting(alias) == state) return
        pm.setComponentEnabledSetting(alias, state, PackageManager.DONT_KILL_APP)
    }
}
