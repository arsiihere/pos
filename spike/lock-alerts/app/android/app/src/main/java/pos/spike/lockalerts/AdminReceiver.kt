package pos.spike.lockalerts

import android.app.admin.DeviceAdminReceiver

/** [spike lock-alerts] Only so `adb shell dpm set-device-owner pos.spike.lockalerts/.AdminReceiver` can be tried (OQ2, R33). */
class AdminReceiver : DeviceAdminReceiver()
