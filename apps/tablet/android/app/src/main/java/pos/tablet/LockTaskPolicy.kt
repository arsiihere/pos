package pos.tablet

import android.app.admin.DevicePolicyManager
import pos.tablet.MainHealth.ActivityManagerModes

/**
 * 05b M-17 (N-4, N-13, O-16, O-19; plan A15): what the activity does about lock task, as a pure decision.
 * [DeviceOwner] runs the actions in order.
 *
 * - Not device owner → nothing (no lock task, no screen-pinning prompt).
 * - Device owner → grants itself `POST_NOTIFICATIONS` (API 33+), on approver tablets too (M-17).
 * - Device owner + `lock_task` true (`everyone`) → whitelist this package, features (API 28+), the app as the
 *   persistent preferred HOME (HomeAlias), then `startLockTask()` when resumed and not already locked.
 * - Device owner + `lock_task` false (`listed`) → `stopLockTask()` if locked (never a user's screen pin), clear
 *   the preferred HOME, disable HomeAlias, clear the whitelist (else `lockTaskMode="if_whitelisted"` re-locks).
 * There is no page-callable exit: the only input is `setDeviceContext.lock_task` (O-14).
 */
object LockTaskPolicy {
    enum class Action {
        GRANT_POST_NOTIFICATIONS,
        SET_LOCK_TASK_PACKAGES,
        SET_LOCK_TASK_FEATURES,
        ENABLE_HOME_ALIAS,
        SET_PREFERRED_HOME,
        START_LOCK_TASK,
        STOP_LOCK_TASK,
        CLEAR_PREFERRED_HOME,
        DISABLE_HOME_ALIAS,
        CLEAR_LOCK_TASK_PACKAGES,
    }

    /** N-13: heads-up, shade and FSI (NOTIFICATIONS needs HOME), the power menu; no KEYGUARD. */
    const val FEATURES = DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS or
        DevicePolicyManager.LOCK_TASK_FEATURE_HOME or
        DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS

    /** [lockTaskModeState] is `ActivityManager.getLockTaskModeState()`; [resumed] whether the activity is resumed. */
    fun decide(deviceOwner: Boolean, lockTask: Boolean, lockTaskModeState: Int, sdk: Int, resumed: Boolean): List<Action> {
        if (!deviceOwner) return emptyList()
        val out = ArrayList<Action>()
        if (sdk >= 33) out += Action.GRANT_POST_NOTIFICATIONS
        if (lockTask) {
            out += Action.SET_LOCK_TASK_PACKAGES
            if (sdk >= 28) out += Action.SET_LOCK_TASK_FEATURES
            out += Action.ENABLE_HOME_ALIAS
            out += Action.SET_PREFERRED_HOME
            if (resumed && lockTaskModeState != ActivityManagerModes.LOCKED) out += Action.START_LOCK_TASK
        } else {
            if (lockTaskModeState == ActivityManagerModes.LOCKED) out += Action.STOP_LOCK_TASK
            out += Action.CLEAR_PREFERRED_HOME
            out += Action.DISABLE_HOME_ALIAS
            out += Action.CLEAR_LOCK_TASK_PACKAGES
        }
        return out
    }
}
