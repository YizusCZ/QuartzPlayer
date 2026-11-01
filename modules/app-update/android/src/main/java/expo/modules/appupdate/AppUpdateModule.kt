package expo.modules.appupdate

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Installs Quartz updates downloaded from its GitHub releases: the APK is
 * handed to Android's own installer, which asks the user and checks that it
 * is signed with the same key as the installed app.
 */
class AppUpdateModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw CodedException("NO_CONTEXT", "No context", null)

  override fun definition() = ModuleDefinition {
    Name("AppUpdate")

    /** The installed version (versionName) and its build number (versionCode). */
    Function("installed") {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
      mapOf("version" to (info.versionName ?: ""), "code" to code.toDouble())
    }

    /** Android 8+ asks once per app before it may open the installer. */
    Function("canInstall") {
      Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()
    }

    Function("openInstallPermission") {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** Opens the app anew from a new process (a theme read once at startup). */
    Function("restart") {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: throw CodedException("NO_INTENT", "No launch intent", null)
      context.startActivity(Intent.makeRestartActivityTask(launch.component))
      Runtime.getRuntime().exit(0)
    }

    /** `path`: a file:// URI or path inside the cache's updates/ folder. */
    Function("install") { path: String ->
      val file = File(Uri.parse(path).path ?: path)
      if (!file.exists()) throw CodedException("NO_FILE", "Update file not found", null)
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.appupdate", file)
      val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }
}
