<p align="center">
  <img src="assets/icon.png" alt="Logo de Quartz" width="140" />
</p>

<h1 align="center">QuartzPlayer</h1>

<p align="center">
  Reproductor de música Hi-Res para Android, hecho con Expo y React Native.<br />
  Tu biblioteca local, a su resolución original, con un cassette animado como visualizador.
</p>

---

## Qué es

Quartz reproduce los archivos de música que ya tienes en el teléfono (FLAC, ALAC, WAV, AIFF, MP3, AAC) sin transcodificarlos. La interfaz se inspira en los reproductores portátiles de alta fidelidad: oscura, con un color de acento configurable y controles grandes. Al reproducir, la pantalla pasa a un cassette dibujado con Skia cuyos carretes giran con física real de cinta.

No incluye, vende ni distribuye música: funciona con los archivos que tengas derecho a reproducir.

## Funciones

**Reproducción**
- Decodificación nativa con ExoPlayer, sin transcodificar.
- Cola con aleatorio, repetición, "reproducir a continuación", repetición A-B, velocidad de 0.75x a 1.5x y temporizador de apagado.
- Controles en la notificación y en la pantalla de bloqueo: anterior, siguiente, barra de progreso y botón de favoritos.
- Retoma la pista y la posición donde te quedaste.

**Efectos de sonido** (procesador propio dentro de ExoPlayer)
- Tono: Nightcore (1.25x, más agudo) o Slowed (0.8x, más grave). Son excluyentes.
- Efectos combinables: Reverb, Eco, Audio 8D, Bass boost, Lo-fi, Radio y Karaoke. Lo-fi y Radio se excluyen entre sí.
- Combinaciones listas: Slowed + Reverb, Lo-fi chill, Nightcore 8D y En vivo.
- Ecualizador de 10 bandas con preamplificador y presets.

**Visualizadores**
- **Cassette:** 12 estilos (Magenta, Sunset, Graphite Metal, Crystal, Noir, Vaporwave, Jade, Retro 70s, Océano, Sakura, Neón lima y Chrome Metal). La cinta pasa de un carrete a otro con el progreso; doble toque para el lado B.
- **Pantalla siempre activa:** tras un rato sin tocar, el cassette se atenúa sobre negro con la hora, y el contenido se desplaza cada minuto para no marcar el panel.
- **Letras:** karaoke sincronizado palabra por palabra.
- **Vídeo:** tus propios vídeos, por canción o para todas; si duran lo mismo que la canción, se sincronizan con ella. Sin vídeo propio, se usa la portada animada del álbum cuando existe.
- **Barras, LED Hi-Fi, Espejo, Radial, VU analógico y Osciloscopio.** Pueden tomar los colores de la portada que suena (paleta "Portada").

**Biblioteca y listas**
- Detecta toda la música del dispositivo; lector de etiquetas propio (FLAC/Vorbis, ID3v2, MP4, RIFF, AIFF).
- Canciones, Álbumes, Artistas, Géneros, Carpetas, Hi-Res, Favoritas, Recientes y Más escuchadas.
- Listas con carátula de cassette por defecto, o con una imagen tuya. Se crean desde el inicio con un toque y se llenan eligiendo varias canciones a la vez.

**Música libre**
- Búsqueda y descarga de música legal desde Jamendo (artistas independientes, en FLAC) e Internet Archive (Live Music Archive y audio con licencia Creative Commons o de dominio público).
- Las descargas entran en la biblioteca con su carátula, su artista y su licencia, visible en la ficha técnica de cada canción.
- Las grabaciones que los servicios marcan como solo para escuchar en línea no se ofrecen.

**Calidad y salida de audio**
- Ficha de calidad por pista: formato, bits, frecuencia, rango dinámico y nivel (de "Básica" a "Máster de estudio").
- Muestra el dispositivo de salida, su frecuencia y el códec Bluetooth cuando el sistema lo expone.

**Personalización e integraciones**
- Color principal libre y AmbientShare: fondo translúcido en movimiento con los colores de la portada.
- Portadas animadas en la carátula del reproductor.
- Presencia en Discord con la canción, la portada y un icono del efecto activo.

## Requisitos

- Node.js 20 o superior y npm.
- Android Studio con el SDK de Android y el NDK 27 (para los módulos nativos).
- Un teléfono Android con depuración USB, o un emulador.

Quartz usa módulos nativos propios, así que **no funciona en Expo Go**: necesita una build de desarrollo o de release.

## Puesta en marcha

```bash
git clone <url-del-repositorio> QuartzPlayer
cd QuartzPlayer
npm install            # también aplica los parches de patches/ (patch-package)
cp .env.example .env   # y rellena los valores
```

### Variables de entorno

| Variable | Para qué sirve |
| --- | --- |
| `EXPO_PUBLIC_DISCORD_APP_ID` | ID de tu aplicación en el Discord Developer Portal. Sin ella, la presencia en Discord aparece como no disponible. |
| `EXPO_PUBLIC_JAMENDO_CLIENT_ID` | Client ID de [Jamendo](https://developer.jamendo.com). Sin él, Música libre solo busca en Internet Archive. |
| `JAMENDO_CLIENT_SECRET` | Opcional, solo para OAuth. No lleva el prefijo `EXPO_PUBLIC_` para que nunca se incruste en la app. |

El archivo `.env` no se sube al repositorio. Las variables `EXPO_PUBLIC_*` se incrustan en el bundle al compilar.

### SDK de Discord

El SDK de Discord Social es propietario y no se puede redistribuir, por eso no está en el repositorio. Para compilar:

1. Descárgalo desde el [Discord Developer Portal](https://discord.com/developers/docs/discord-social-sdk/overview).
2. Copia `discord_partner_sdk.aar` en `modules/discord-presence/android/libs/`.

### Compilar e instalar

```bash
npx expo run:android                    # build de desarrollo en el teléfono conectado
npx expo run:android --variant release  # build release (mucho más fluida)
```

Para generar solo el APK release (por ejemplo, para instalarlo sin cable más tarde):

```bash
npx expo prebuild -p android
cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: android/app/build/outputs/apk/release/app-release.apk
```

La carpeta `android/` se genera con `expo prebuild` y no se versiona. La configuración nativa vive en `app.json` y en los config plugins de `plugins/`.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run typecheck` | Comprueba los tipos con TypeScript |
| `npx expo lint` | Pasa ESLint |
| `npm run preview` | Dibuja el cassette y las carátulas de lista sin dispositivo, en `tools/preview-out/` |
| `npm run brand` | Regenera el ícono, el splash y el logo desde `assets/brand/logo-source.png` |

## Estructura

```
src/
  app/            pantallas (expo-router): inicio, reproductor, listas, búsqueda, cola, ajustes
  audio/          motor de reproducción, efectos, ecualizador, analizador FFT, salida de audio
  components/     cassette, visualizadores, carátulas de lista y piezas de interfaz
  library/        lector de etiquetas, escáner de la biblioteca, calidad
  media/          portadas animadas
  store/          estado persistido con zustand
modules/          módulos nativos propios: audio-dsp, audio-route, discord-presence
patches/          parche de expo-audio (procesador de efectos, notificación)
plugins/          config plugins de Expo
tools/            vista previa sin dispositivo y utilidades
```

## Privacidad

La biblioteca, las listas y los ajustes se guardan solo en el teléfono. No hay cuentas, anuncios ni analíticas. Las funciones en línea (letras, portadas animadas, Discord) son opcionales y se explican en la app, en Ajustes → Privacidad, usos y créditos.

## Licencia

Copyright (c) 2026 YizusTC (Jesus Rafael Tapia Camargo). Todos los derechos reservados.

El código es visible para consulta, pero **no se permite copiarlo, modificarlo, distribuirlo ni usarlo** en otros proyectos sin permiso por escrito del autor. Consulta las condiciones completas en [LICENSE](LICENSE).

## Créditos

- Letras sincronizadas: [LRCLIB](https://lrclib.net).
- Música libre: [Jamendo](https://www.jamendo.com) e [Internet Archive](https://archive.org).
- Portadas animadas y búsqueda de álbumes: Apple Music / iTunes.
- Iconos de efectos en Discord: [Twemoji](https://github.com/jdecked/twemoji), CC-BY 4.0.

<p align="center">
  <img src="assets/images/thanks-cat.png" alt="Gato con audífonos" width="220" /><br />
  <b>Gracias por usar Quartz</b>
</p>
