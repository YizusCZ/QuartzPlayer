package expo.modules.audioroute

import android.Manifest
import android.bluetooth.BluetoothA2dp
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reports where audio is currently playing: device kind and name, the mixer
 * output rate, the formats the device accepts and — for Bluetooth, when the
 * OS allows it — the negotiated codec, sample rate and bit depth.
 */
class AudioRouteModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No context")

  private val audioManager: AudioManager
    get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private val handler = Handler(Looper.getMainLooper())
  private var keepAliveTask: Int? = null
  private var a2dp: BluetoothA2dp? = null

  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = emitSoon()
    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = emitSoon()
  }

  /** Sleep timer: a PAUSE media key reaches the app's own active media session. */
  private val sleepRunnable = Runnable {
    try {
      val now = android.os.SystemClock.uptimeMillis()
      audioManager.dispatchMediaKeyEvent(
        android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_MEDIA_PAUSE, 0)
      )
      audioManager.dispatchMediaKeyEvent(
        android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_MEDIA_PAUSE, 0)
      )
    } catch (_: Throwable) {
    }
  }

  private fun emitSoon() {
    // Routing settles a moment after the device list changes.
    handler.postDelayed({ sendEvent("onChange", current()) }, 400)
  }

  override fun definition() = ModuleDefinition {
    Name("AudioRoute")
    Events("onChange")

    Function("getCurrent") { current() }

    /** Call after BLUETOOTH_CONNECT is granted so codec details become available. */
    Function("refresh") {
      connectA2dp()
      current()
    }

    Function("scheduleSleep") { ms: Double ->
      handler.removeCallbacks(sleepRunnable)
      handler.postDelayed(sleepRunnable, ms.toLong())
    }

    Function("cancelSleep") {
      handler.removeCallbacks(sleepRunnable)
    }

    /**
     * Opens the system output switcher (the same panel as the quick settings
     * media card). Android 14+; older versions fall back to Bluetooth settings.
     */
    /**
     * Keeps JS timers running with the app in the background (a listening room
     * needs its heartbeat and drift checks). React Native stops timers once the
     * activity pauses unless a headless task is active, so one is held open
     * for as long as the room lasts.
     */
    Function("setKeepAlive") { on: Boolean ->
      val rc = appContext.reactContext as? ReactContext ?: return@Function false
      UiThreadUtil.runOnUiThread {
        val tasks = HeadlessJsTaskContext.getInstance(rc)
        val running = keepAliveTask
        if (on && (running == null || !tasks.isTaskRunning(running))) {
          keepAliveTask = try {
            tasks.startTask(HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), 0, true))
          } catch (_: Throwable) {
            null
          }
        } else if (!on && running != null) {
          if (tasks.isTaskRunning(running)) tasks.finishTask(running)
          keepAliveTask = null
        }
      }
      true
    }

    Function("showOutputSwitcher") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        try {
          if (android.media.MediaRouter2.getInstance(context).showSystemOutputSwitcher()) return@Function true
        } catch (_: Throwable) {
        }
      }
      try {
        val intent = android.content.Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)
          .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
      } catch (_: Throwable) {
        false
      }
    }

    OnStartObserving {
      audioManager.registerAudioDeviceCallback(deviceCallback, handler)
      connectA2dp()
    }

    OnStopObserving {
      audioManager.unregisterAudioDeviceCallback(deviceCallback)
    }
  }

  private fun hasBtPermission(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

  private fun connectA2dp() {
    if (a2dp != null || !hasBtPermission()) return
    try {
      val adapter: BluetoothAdapter =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter ?: return
      adapter.getProfileProxy(context, object : BluetoothProfile.ServiceListener {
        override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
          a2dp = proxy as BluetoothA2dp
          emitSoon()
        }
        override fun onServiceDisconnected(profile: Int) {
          a2dp = null
        }
      }, BluetoothProfile.A2DP)
    } catch (_: Throwable) {
    }
  }

  private fun activeOutput(): AudioDeviceInfo? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()
      audioManager.getAudioDevicesForAttributes(attrs).firstOrNull()?.let { return it }
    }
    val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val priority = listOf(
      AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE,
      AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER,
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
    )
    for (type in priority) outputs.firstOrNull { it.type == type }?.let { return it }
    return outputs.firstOrNull()
  }

  private fun kindOf(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
    AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER, AudioDeviceInfo.TYPE_BLE_BROADCAST -> "ble"
    AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "usb"
    AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC, AudioDeviceInfo.TYPE_HDMI_EARC -> "hdmi"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "speaker"
    AudioDeviceInfo.TYPE_HEARING_AID -> "hearing"
    else -> "other"
  }

  private fun encodingName(e: Int): String? = when (e) {
    AudioFormat.ENCODING_PCM_16BIT -> "PCM 16-bit"
    AudioFormat.ENCODING_PCM_24BIT_PACKED -> "PCM 24-bit"
    AudioFormat.ENCODING_PCM_32BIT -> "PCM 32-bit"
    AudioFormat.ENCODING_PCM_FLOAT -> "PCM float"
    else -> null
  }

  /** Negotiated A2DP codec via the (non-SDK) getCodecStatus; null when the OS blocks it. */
  private fun bluetoothCodec(address: String?): Map<String, Any?>? {
    val proxy = a2dp ?: return null
    if (!hasBtPermission()) return null
    return try {
      val device: BluetoothDevice = proxy.connectedDevices.firstOrNull { address == null || it.address == address }
        ?: proxy.connectedDevices.firstOrNull() ?: return null
      val status = proxy.javaClass.getMethod("getCodecStatus", BluetoothDevice::class.java).invoke(proxy, device)
        ?: return null
      val config = status.javaClass.getMethod("getCodecConfig").invoke(status) ?: return null
      val type = config.javaClass.getMethod("getCodecType").invoke(config) as Int
      val rateFlag = config.javaClass.getMethod("getSampleRate").invoke(config) as Int
      val bitsFlag = config.javaClass.getMethod("getBitsPerSample").invoke(config) as Int
      val codec = when (type) {
        0 -> "SBC"; 1 -> "AAC"; 2 -> "aptX"; 3 -> "aptX HD"; 4 -> "LDAC"; 5 -> "LC3"; 6 -> "Opus"
        else -> "Bluetooth"
      }
      val rate = when (rateFlag) {
        1 -> 44100; 2 -> 48000; 4 -> 88200; 8 -> 96000; 16 -> 176400; 32 -> 192000
        else -> null
      }
      val bits = when (bitsFlag) { 1 -> 16; 2 -> 24; 4 -> 32; else -> null }
      mapOf("codec" to codec, "codecSampleRate" to rate, "codecBitDepth" to bits)
    } catch (_: Throwable) {
      null
    }
  }

  private fun current(): Map<String, Any?> {
    val dev = activeOutput()
    val kind = dev?.let { kindOf(it.type) } ?: "speaker"
    val mixerRate = audioManager.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull()
    val rates = dev?.sampleRates?.toList() ?: emptyList()
    val encodings = dev?.encodings?.toList()?.mapNotNull { encodingName(it) }?.distinct() ?: emptyList()
    val address = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) dev?.address else null
    val bt = if (kind == "bluetooth") bluetoothCodec(address) else null
    val name = dev?.productName?.toString()?.takeIf { it.isNotBlank() && it != Build.MODEL }
    return mapOf(
      "kind" to kind,
      "name" to (name ?: if (kind == "speaker") "Altavoz del teléfono" else null),
      "sampleRate" to mixerRate,
      "supportedRates" to rates,
      "encodings" to encodings,
      "channels" to (dev?.channelCounts?.maxOrNull()),
      "codec" to bt?.get("codec"),
      "codecSampleRate" to bt?.get("codecSampleRate"),
      "codecBitDepth" to bt?.get("codecBitDepth"),
      "needsPermission" to (kind == "bluetooth" && !hasBtPermission()),
    )
  }
}

/** Registered in JS (src/jam/keepAlive.ts) as a task that never finishes on its own. */
private const val KEEP_ALIVE_TASK = "QuartzKeepAlive"
