/**
 * Keeps release builds within the memory of a 16 GB machine: no parallel
 * project builds, two workers and a smaller Kotlin daemon. Written into
 * android/gradle.properties on every `expo prebuild`.
 */
const { withGradleProperties } = require('expo/config-plugins');

const PROPS = {
  'org.gradle.parallel': 'false',
  'org.gradle.workers.max': '2',
  'kotlin.daemon.jvmargs': '-Xmx1024m',
};

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      const item = cfg.modResults.find((p) => p.type === 'property' && p.key === key);
      if (item) item.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
