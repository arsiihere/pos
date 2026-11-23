package pos.tablet

/**
 * 05b shared contract between the main process (MainActivity, PosNativePlugin) and the `:alerts` process
 * (AlertService, Watchdog, BootReceiver). Every lane codes against these names; change them only here.
 *
 * Cross-process messages are explicit broadcasts within the package, sent with FLAG_RECEIVER_FOREGROUND
 * (spec M-4, N-17). Requests go main → :alerts to [Ipc.ACTION_TO_ALERTS]; replies and state go
 * :alerts → main to [Ipc.ACTION_TO_MAIN]. Every message carries [Ipc.EXTRA_OP] and, for a request that
 * expects a reply, [Ipc.EXTRA_REQ_ID] echoed in the reply.
 */
object Ipc {
    const val ACTION_TO_ALERTS = "pos.tablet.TO_ALERTS"
    const val ACTION_TO_MAIN = "pos.tablet.TO_MAIN"

    const val EXTRA_OP = "op"
    const val EXTRA_REQ_ID = "req_id"
    const val EXTRA_JSON = "json" // payload / reply body as a JSON string

    // main → :alerts
    const val OP_SET_DEVICE_TOKEN = "set_device_token"   // json { token, device_id, device_type, hub_origin }
    const val OP_CONFIRM_REVOKED = "confirm_revoked"     // reply json { revoked, reason? }  (§3.5)
    const val OP_SET_SESSION = "set_session"             // json { signed_in, staff_id? }   (M-21)
    const val OP_SET_DEVICE_CONTEXT = "set_device_context" // json { always_on, language, lock_task } (M-21)
    const val OP_REPORT_SHOWN = "report_shown"           // json { alert_id, step }          (M-8)
    const val OP_ACTIVITY_VISIBLE = "activity_visible"   // json { visible }                 (O-18)
    const val OP_HEALTH = "health"                       // reply json: the :alerts half of M-18
    const val OP_SET_WAKE_LOCK = "set_wake_lock"         // json { on }                      (M-5)
    const val OP_CHECK_FOR_UPDATE = "check_for_update"   // reply json { state }             (M-15)

    // :alerts → main
    const val OP_REPLY = "reply"                         // json = the reply body
    const val OP_STATE = "state"                         // json = the `state` event body    (§4.2)
    const val OP_SERVICE_STARTED = "service_started"     // → plugin emits state { needs_context: true } (N-1)
}

/** Store file names and their owner process (spec §5, N-10). Only the owner opens / creates a store. */
object Stores {
    const val MAIN_SECURE = "main_secure"     // main process: hub_origin
    const val MAIN_PLAIN = "main_plain"       // main process: lock_task
    const val ALERTS_SECURE = "alerts_secure" // :alerts: device_token, device_id
    const val ALERTS_PLAIN = "alerts_plain"   // :alerts: want_running, wake_lock, dedupe, open urgent, always_on, language, last_update_check
}

/** Notification channel ids (spec M-9). A sound change bumps the suffix and deletes the old channel. */
object Channels {
    const val STATUS = "pos_status_v1"
    const val URGENT = "pos_urgent_v1"
    const val ACTION = "pos_action_v1"
    const val INFO = "pos_info_v1"
    const val RESULT = "pos_result_v1"
}

/** Constants fixed by the spec. */
object Spec {
    const val NATIVE_API = 1                        // M-14
    const val PROBE_TIMEOUT_MS = 3_000L             // M-1 / N-3
    const val FIRST_FRAME_TIMEOUT_MS = 10_000L      // M-4
    val BACKOFF_MS = longArrayOf(500, 1_000, 2_000, 4_000, 5_000) // M-4
    const val PING_S = 15L                          // M-4
    const val REPLACED_RECONNECT_MS = 60_000L       // §3.5 4409
    const val DEDUPE_KEYS = 2_000                   // M-7
    const val REPORT_SHOWN_HOLD_MS = 1_000L         // M-8
    const val URGENT_REPEAT_MS = 10_000L            // M-10
    const val URGENT_REMINDER_MS = 120_000L         // M-10
    const val WATCHDOG_MS = 600_000L                // M-6
    const val BOOT_WATCHDOG_MS = 60_000L            // M-6
    const val TASK_REMOVED_WATCHDOG_MS = 2_000L     // M-6
    const val UPDATE_CHECK_MS = 3_600_000L          // M-15
    const val UNREACHABLE_RETRY_MS = 5_000L         // M-16
    const val LOG_ROTATE_BYTES = 5L * 1024 * 1024   // M-19
}
