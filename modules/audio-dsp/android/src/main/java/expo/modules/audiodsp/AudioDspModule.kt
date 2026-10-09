package expo.modules.audiodsp

import android.media.audiofx.DynamicsProcessing
import android.os.Build
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.sharedobjects.SharedObject
import expo.modules.kotlin.sharedobjects.SharedRef

/**
 * 10-band graphic equaliser on the player's own audio session, built on
 * DynamicsProcessing (API 28+): true per-band gains at fixed centre
 * frequencies, an input preamp and a brick-wall limiter so boosts never clip.
 */
class AudioDspModule : Module() {
  private var dp: DynamicsProcessing? = null
  private var session = -1

  private val centres = floatArrayOf(31f, 62f, 125f, 250f, 500f, 1000f, 2000f, 4000f, 8000f, 16000f)

  /** Band i covers up to the geometric midpoint with band i+1. */
  private fun cutoff(i: Int): Float =
    if (i == centres.size - 1) 20000f else Math.sqrt((centres[i] * centres[i + 1]).toDouble()).toFloat()

  private fun sessionOf(player: SharedObject): Int? {
    val exo = (player as? SharedRef<*>)?.ref ?: return null
    return try {
      exo.javaClass.getMethod("getAudioSessionId").invoke(exo) as Int
    } catch (_: Throwable) {
      null
    }
  }

  private fun ensure(sessionId: Int): DynamicsProcessing? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
    if (dp != null && session == sessionId) return dp
    dp?.release()
    val config = DynamicsProcessing.Config.Builder(
      DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
      2,
      true, centres.size,
      false, 0,
      false, 0,
      true,
    ).build()
    dp = DynamicsProcessing(0, sessionId, config)
    session = sessionId
    return dp
  }

  override fun definition() = ModuleDefinition {
    Name("AudioDsp")

    Function("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.P }

    Function("bandFrequencies") { centres.toList() }

    AsyncFunction("setEqualizer") { player: SharedObject, enabled: Boolean, preamp: Double, gains: List<Double> ->
      val id = sessionOf(player) ?: return@AsyncFunction false
      if (id == 0) return@AsyncFunction false
      val fx = ensure(id) ?: return@AsyncFunction false
      if (!enabled) {
        fx.enabled = false
        return@AsyncFunction true
      }
      for (i in centres.indices) {
        val g = gains.getOrNull(i)?.toFloat() ?: 0f
        fx.setPreEqBandAllChannelsTo(i, DynamicsProcessing.EqBand(true, cutoff(i), g))
      }
      fx.setInputGainAllChannelsTo(preamp.toFloat())
      // attack 1 ms, release 60 ms, ratio 10:1, threshold −1 dBFS: transparent unless a boost would clip.
      fx.setLimiterAllChannelsTo(DynamicsProcessing.Limiter(true, true, 0, 1f, 60f, 10f, -1f, 0f))
      fx.enabled = true
      true
    }.runOnQueue(Queues.MAIN)

    // Sound effects run inside expo-audio's pipeline (QuartzFx, added by our
    // patch); reached by reflection so this module doesn't link against it.
    Function("setEffects") { values: List<Double> ->
      try {
        Class.forName("expo.modules.audio.QuartzFx")
          .getMethod("configure", FloatArray::class.java)
          .invoke(null, values.map { it.toFloat() }.toFloatArray())
        true
      } catch (_: Throwable) {
        false
      }
    }

    OnDestroy {
      dp?.release()
      dp = null
    }
  }
}
