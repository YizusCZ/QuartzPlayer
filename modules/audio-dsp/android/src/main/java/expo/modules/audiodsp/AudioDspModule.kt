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
 * frequencies, an input preamp, left/right balance, a one-band compressor
 * that evens out loud and quiet passages, and a brick-wall limiter so boosts
 * never clip.
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
      true, 1,
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

    AsyncFunction("setEqualizer") { player: SharedObject, enabled: Boolean, preamp: Double, gains: List<Double>,
                                    balance: Double, leveling: Double ->
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
      // Balance: the far side is turned down, never the near one up.
      val b = balance.coerceIn(-1.0, 1.0)
      fun db(v: Double) = if (v <= 0.001) -60f else (20 * Math.log10(v)).toFloat().coerceAtLeast(-60f)
      fx.setInputGainbyChannel(0, preamp.toFloat() + db(if (b > 0) 1 - b else 1.0))
      fx.setInputGainbyChannel(1, preamp.toFloat() + db(if (b < 0) 1 + b else 1.0))
      // Leveling 0…1: up to 4:1 above −30 dBFS, with make-up gain so it doesn't just get quieter.
      val l = leveling.coerceIn(0.0, 1.0).toFloat()
      fx.setMbcBandAllChannelsTo(
        0,
        DynamicsProcessing.MbcBand(
          l > 0f, 20000f, 8f, 250f, 1f + 3f * l, -12f - 18f * l, 8f, -90f, 1f, 0f, 9f * l
        )
      )
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
