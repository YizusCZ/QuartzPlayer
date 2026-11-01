/**
 * Signs release builds with Quartz's own key, so every new APK installs over
 * the last one (Android only accepts an update signed with the same key).
 *
 * The key and its passwords never live in the repo: they are read from
 * ~/.gradle/gradle.properties (QUARTZ_RELEASE_STORE_FILE, _STORE_PASSWORD,
 * _KEY_ALIAS, _KEY_PASSWORD). Without them, release builds fall back to the
 * debug key, as before. Written into android/app/build.gradle on every
 * `expo prebuild`.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// quartz-release-signing';

const RELEASE_CONFIG = `
        release { ${MARK}
            if (project.hasProperty('QUARTZ_RELEASE_STORE_FILE')) {
                storeFile file(QUARTZ_RELEASE_STORE_FILE)
                storePassword QUARTZ_RELEASE_STORE_PASSWORD
                keyAlias QUARTZ_RELEASE_KEY_ALIAS
                keyPassword QUARTZ_RELEASE_KEY_PASSWORD
            }
        }`;

function apply(gradle) {
  if (gradle.includes(MARK)) return gradle;
  // A release signing config next to the debug one…
  let out = gradle.replace(/(signingConfigs\s*\{\s*\n\s*debug\s*\{[^}]*\})/, `$1${RELEASE_CONFIG}`);
  // …used by the release build type when the key is there.
  out = out.replace(
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
    "$1signingConfig project.hasProperty('QUARTZ_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
  );
  if (out === gradle || !out.includes(MARK))
    throw new Error('withReleaseSigning: android/app/build.gradle changed shape');
  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = apply(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.apply = apply;
