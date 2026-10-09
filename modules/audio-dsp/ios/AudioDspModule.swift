import ExpoModulesCore

/// iOS: AVPlayer has no public per-session EQ hook; reported as unsupported
/// until an MTAudioProcessingTap-based implementation lands.
public class AudioDspModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioDsp")
    Function("isSupported") { false }
    Function("bandFrequencies") { [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] }
    AsyncFunction("setEqualizer") { (_: SharedObject, _: Bool, _: Double, _: [Double]) -> Bool in
      return false
    }
    Function("setEffects") { (_: [Double]) -> Bool in false }
  }
}
