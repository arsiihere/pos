package pos.tablet

import android.app.admin.DeviceAdminReceiver

/** 05b M-17: device owner receiver (`adb shell dpm set-device-owner <appId>/pos.tablet.PosDeviceAdmin`). */
class PosDeviceAdmin : DeviceAdminReceiver()
