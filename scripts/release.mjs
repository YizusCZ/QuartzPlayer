#!/usr/bin/env node
/**
 * Publishes a Quartz update: phones with Quartz installed see it on their own
 * (src/lib/appUpdate.ts reads the repo's latest GitHub release).
 *
 *   node scripts/release.mjs 1.0.5 --notes "Juegos en las salas, importar listas…"
 *   node scripts/release.mjs 1.0.5 --notes-file notas.md
 *   node scripts/release.mjs 1.0.5 --no-build      (reuse the APK already built)
 *
 * 1. Writes the version into app.json and android/app/build.gradle
 *    (versionCode = major·10000 + minor·100 + patch).
 * 2. Builds the release APK within the machine's memory limits.
 * 3. Checks it is signed with Quartz's own key, not the debug one.
 * 4. Copies it to dist/Quartz-<version>.apk.
 * 5. With GITHUB_TOKEN set (a token with "Contents: write" on the repo, never
 *    committed), creates the release v<version> and uploads the APK; without
 *    it, prints the steps to do it on github.com.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'YizusCZ/QuartzPlayer';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APK = join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');

const args = process.argv.slice(2);
const version = args[0];
const flag = (name) => {
  const i = args.indexOf(name);
  return i > 0 ? args[i + 1] : undefined;
};
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Uso: node scripts/release.mjs <versión x.y.z> [--notes "…" | --notes-file archivo] [--no-build]');
  process.exit(1);
}
const [major, minor, patch] = version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + patch;
const notesFile = flag('--notes-file');
const notes = notesFile ? readFileSync(notesFile, 'utf8') : (flag('--notes') ?? '');

// 1. version
const appJsonPath = join(ROOT, 'app.json');
const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
appJson.expo.version = version;
appJson.expo.android = { ...appJson.expo.android, versionCode };
writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
const gradlePath = join(ROOT, 'android/app/build.gradle');
const gradle = readFileSync(gradlePath, 'utf8')
  .replace(/versionCode \d+/, `versionCode ${versionCode}`)
  .replace(/versionName "[^"]*"/, `versionName "${version}"`);
writeFileSync(gradlePath, gradle);
console.log(`› Versión ${version} (versionCode ${versionCode})`);

// 2. build
if (!args.includes('--no-build')) {
  console.log('› Compilando el APK (1–3 min)…');
  const build = spawnSync(
    'systemd-run',
    [
      '--user',
      '--scope',
      '--quiet',
      '-p',
      'MemoryMax=6G',
      '-p',
      'MemorySwapMax=0',
      '-p',
      'CPUQuota=600%',
      'env',
      'NODE_OPTIONS=--max-old-space-size=2048',
      'CMAKE_BUILD_PARALLEL_LEVEL=2',
      'nice',
      '-n',
      '10',
      './gradlew',
      ':app:assembleRelease',
      '--no-daemon',
      '--max-workers=1',
      '-PreactNativeArchitectures=arm64-v8a',
      '-Pkotlin.compiler.execution.strategy=in-process',
      '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m',
      '--console=plain',
    ],
    { cwd: join(ROOT, 'android'), stdio: 'inherit' },
  );
  if (build.status !== 0) {
    console.error('✗ La compilación falló');
    process.exit(1);
  }
}
if (!existsSync(APK)) {
  console.error(`✗ No existe ${APK}`);
  process.exit(1);
}

// 3. signature (apksigner reads the v2/v3 signatures; keytool only sees the old v1 one)
const sdk = process.env.ANDROID_HOME ?? join(process.env.HOME ?? '', 'Android/Sdk');
const tools = existsSync(join(sdk, 'build-tools')) ? readdirSync(join(sdk, 'build-tools')).sort() : [];
const apksigner = tools.length ? join(sdk, 'build-tools', tools[tools.length - 1], 'apksigner') : null;
if (!apksigner || !existsSync(apksigner)) {
  console.error('✗ No encontré apksigner (Android SDK build-tools) para revisar la firma');
  process.exit(1);
}
const cert = execFileSync(apksigner, ['verify', '--print-certs', APK], { encoding: 'utf8' });
if (/CN=Android Debug/i.test(cert)) {
  console.error(
    '✗ El APK está firmado con la llave de prueba. Faltan las QUARTZ_RELEASE_* en ~/.gradle/gradle.properties.',
  );
  process.exit(1);
}
const sha = /SHA-256 digest:\s*([0-9a-f]+)/i.exec(cert)?.[1];
console.log(`› Firma propia ${sha ? `${sha.slice(0, 16)}…` : ''}`);

// 4. dist
mkdirSync(join(ROOT, 'dist'), { recursive: true });
const name = `Quartz-${version}.apk`;
const out = join(ROOT, 'dist', name);
copyFileSync(APK, out);
console.log(`› ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);

// 5. GitHub release
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.log(`
Para publicarla (sin token):
  1. Abre https://github.com/${REPO}/releases/new
  2. Etiqueta: v${version}   Título: Quartz ${version}
  3. Escribe las novedades y adjunta dist/${name}
  4. Publica (no la marques como pre-release)
O vuelve a correr esto con GITHUB_TOKEN=… para hacerlo automático.`);
  process.exit(0);
}

const gh = async (url, init = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body.message ?? ''}`);
  return body;
};

try {
  console.log('› Creando la release en GitHub…');
  const release = await gh(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: `v${version}`,
      target_commitish: 'main',
      name: `Quartz ${version}`,
      body: notes,
      draft: false,
      prerelease: false,
    }),
  });
  console.log('› Subiendo el APK…');
  await gh(`https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.android.package-archive' },
    body: readFileSync(out),
  });
  console.log(`✓ Publicada: ${release.html_url}`);
} catch (e) {
  console.error(`✗ GitHub: ${e.message}`);
  process.exit(1);
}
