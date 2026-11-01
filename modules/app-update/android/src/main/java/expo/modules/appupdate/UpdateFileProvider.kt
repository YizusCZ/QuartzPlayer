package expo.modules.appupdate

import androidx.core.content.FileProvider

/** Its own class, so it never clashes with another library's FileProvider entry. */
class UpdateFileProvider : FileProvider()
