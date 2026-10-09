package expo.modules.discordpresence

import android.content.pm.PackageManager
import android.os.Handler
import android.os.HandlerThread
import com.discord.socialsdk.DiscordSocialSdkInit
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord

@OptimizedRecord
class Presence : Record {
  /** Activity name ("Escuchando <name>"). */
  @Field val name: String? = null
  @Field val details: String? = null
  @Field val state: String? = null
  @Field val largeImage: String? = null
  @Field val largeText: String? = null
  @Field val smallImage: String? = null
  @Field val smallText: String? = null
  /** Unix epoch, ms. 0 = none. */
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
}

/** Native side of the Social SDK. Every method runs on the module's worker thread. */
class DiscordBridge(private val onResult: (Boolean, String) -> Unit) {
  external fun nativeStart(applicationId: Long)
  external fun nativeUpdate(
    name: String?,
    details: String?,
    state: String?,
    largeImage: String?,
    largeText: String?,
    smallImage: String?,
    smallText: String?,
    startMs: Long,
    endMs: Long
  )
  external fun nativeClear()
  external fun nativeRunCallbacks()
  external fun nativeStop()

  /** Called from native code inside nativeRunCallbacks. */
  @Suppress("unused")
  fun onResult(ok: Boolean, message: String) = onResult.invoke(ok, message)
}

/**
 * Discord Rich Presence ("Escuchando …") through the Discord app installed on the
 * phone, via the Discord Social SDK's RPC transport. No login inside Quartz.
 */
class DiscordPresenceModule : Module() {
  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var bridge: DiscordBridge? = null

  private val pump = object : Runnable {
    override fun run() {
      bridge?.nativeRunCallbacks()
      handler?.postDelayed(this, CALLBACK_INTERVAL_MS)
    }
  }

  private fun post(block: (DiscordBridge) -> Unit) {
    val b = bridge ?: return
    handler?.post { block(b) }
  }

  private fun stopInternal() {
    val h = handler ?: return
    val b = bridge
    h.removeCallbacks(pump)
    h.post {
      b?.nativeStop()
      thread?.quitSafely()
    }
    handler = null
    thread = null
    bridge = null
  }

  override fun definition() = ModuleDefinition {
    Name("DiscordPresence")

    Events("onResult")

    Function("isDiscordInstalled") {
      val pm = appContext.reactContext?.packageManager ?: return@Function false
      try {
        pm.getPackageInfo(DISCORD_PACKAGE, 0)
        true
      } catch (_: PackageManager.NameNotFoundException) {
        false
      }
    }

    Function("start") { applicationId: String ->
      if (bridge != null) return@Function
      // Hands the SDK its Android context (and loads libdiscord_partner_sdk).
      appContext.currentActivity?.let { DiscordSocialSdkInit.setEngineActivity(it) }
      System.loadLibrary("quartz_discord")

      val worker = HandlerThread("QuartzDiscord").apply { start() }
      val h = Handler(worker.looper)
      val b = DiscordBridge { ok, message ->
        sendEvent("onResult", mapOf("ok" to ok, "message" to message))
      }
      thread = worker
      handler = h
      bridge = b
      h.post {
        b.nativeStart(applicationId.toULong().toLong())
        h.post(pump)
      }
    }

    Function("update") { p: Presence ->
      post {
        it.nativeUpdate(
          p.name, p.details, p.state, p.largeImage, p.largeText, p.smallImage, p.smallText,
          p.startMs.toLong(), p.endMs.toLong()
        )
      }
    }

    Function("clear") {
      post { it.nativeClear() }
    }

    Function("stop") {
      stopInternal()
    }

    OnActivityEntersForeground {
      appContext.currentActivity?.let { DiscordSocialSdkInit.setEngineActivity(it) }
    }

    OnDestroy {
      stopInternal()
    }
  }

  companion object {
    private const val DISCORD_PACKAGE = "com.discord"
    private const val CALLBACK_INTERVAL_MS = 100L
  }
}
