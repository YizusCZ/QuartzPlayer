import AVFoundation
import ExpoModulesCore

/// Reports where audio is playing: port kind and name (e.g. "AirPods Pro"),
/// the session's hardware sample rate and channel count.
public class AudioRouteModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AudioRoute")
    Events("onChange")

    Function("getCurrent") { () -> [String: Any?] in
      return self.current()
    }

    Function("refresh") { () -> [String: Any?] in
      return self.current()
    }

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        guard let self = self else { return }
        self.sendEvent("onChange", self.current())
      }
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
      }
      self.observer = nil
    }
  }

  private func kind(of port: AVAudioSession.Port) -> String {
    switch port {
    case .headphones, .lineOut: return "wired"
    case .bluetoothA2DP, .bluetoothHFP: return "bluetooth"
    case .bluetoothLE: return "ble"
    case .usbAudio: return "usb"
    case .airPlay: return "airplay"
    case .HDMI: return "hdmi"
    case .carAudio: return "car"
    case .builtInSpeaker, .builtInReceiver: return "speaker"
    default: return "other"
    }
  }

  private func current() -> [String: Any?] {
    let session = AVAudioSession.sharedInstance()
    let output = session.currentRoute.outputs.first
    let kind = output.map { self.kind(of: $0.portType) } ?? "speaker"
    return [
      "kind": kind,
      "name": output?.portName,
      "sampleRate": session.sampleRate > 0 ? Int(session.sampleRate) : nil,
      "supportedRates": [],
      "encodings": [],
      "channels": session.outputNumberOfChannels,
      "codec": kind == "bluetooth" ? "AAC" : nil,
      "codecSampleRate": nil,
      "codecBitDepth": nil,
      "needsPermission": false,
    ]
  }
}
