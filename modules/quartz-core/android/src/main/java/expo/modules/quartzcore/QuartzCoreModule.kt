package expo.modules.quartzcore

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The Rust library (native/quartz-core), built by scripts/build-rust.sh. */
object RustCore {
  val available = try {
    System.loadLibrary("quartz_core")
    true
  } catch (e: Throwable) {
    false
  }

  external fun parseBatch(items: String, artDir: String): String
}

class QuartzCoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QuartzCore")

    Constant("available") { RustCore.available }

    /** Tags of many files at once, off the JS thread. A JSON array, in order. */
    AsyncFunction("parseBatch") Coroutine { items: String, artDir: String ->
      withContext(Dispatchers.IO) { RustCore.parseBatch(items, artDir) }
    }
  }
}
