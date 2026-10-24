/** The help tours, per screen. `target` is the id given to `useTourRef` / `TourTarget`. */
export type TourStep = { target?: string; title: string; body: string };

export type TourId = 'home' | 'youtube' | 'player' | 'cassette' | 'lyrics' | 'maker' | 'playlist' | 'jam';

/* The player's tours share their top and bottom: only the stage changes per mode. */
const TOP: TourStep[] = [
  { target: 'player.close', title: 'Cerrar', body: 'También puedes deslizar el reproductor hacia abajo.' },
  {
    target: 'player.route',
    title: 'Salida de audio',
    body: 'Dónde suena la música. Tócalo para ver los detalles o cambiar de dispositivo.',
  },
  {
    target: 'player.right',
    title: 'Cola y más opciones',
    body: 'La cola de reproducción y, en el menú, información técnica, ecualizador, ir al álbum o cambiar la portada.',
  },
];

const stage = (body: string): TourStep => ({ target: 'player.stage', title: 'El escenario', body });

/** Tool buttons: only the ones the current mode shows are explained. */
const TOOLS: TourStep[] = [
  { target: 'tool.flip', title: 'Voltear la cinta', body: 'Cambia entre la cara A y la cara B del cassette.' },
  {
    target: 'tool.skins',
    title: 'Estilo del cassette',
    body: 'Elige otro cassette, crea uno con tus colores y stickers, o edita el tuyo.',
  },
  {
    target: 'tool.lock',
    title: 'Modo bolsillo',
    body: 'Bloquea la pantalla para que nada se toque por accidente. Mantén pulsado el candado para desbloquear.',
  },
  {
    target: 'tool.aod',
    title: 'Siempre activa',
    body: 'Una pantalla negra con el cassette girando, que gasta muy poca batería. Toca para volver.',
  },
  {
    target: 'tool.video',
    title: 'Elegir vídeo',
    body: 'Pon un vídeo o un GIF tuyo de fondo para esta canción o para todas.',
  },
  { target: 'tool.watch', title: 'Videoclip', body: 'Esta canción tiene vídeo en YouTube: tócalo para verlo.' },
  {
    target: 'tool.ab',
    title: 'Repetición A-B',
    body: 'Toca una vez para marcar el inicio, otra para el final, y el tramo se repite. Una tercera vez lo quita.',
  },
  {
    target: 'tool.speed',
    title: 'Velocidad',
    body: 'Cambia la velocidad sin tocar el tono, o usa Nightcore y Slowed.',
  },
  { target: 'tool.fx', title: 'Efectos', body: 'Reverb, eco y otros efectos que se pueden combinar.' },
  {
    target: 'tool.sleep',
    title: 'Temporizador',
    body: 'La música se detiene sola pasado un tiempo o al acabar la canción.',
  },
  { target: 'tool.eq', title: 'Ecualizador', body: 'Ajusta graves, medios y agudos con presets o a mano.' },
];

const BOTTOM: TourStep[] = [
  {
    target: 'player.info',
    title: 'La canción',
    body: 'Toca el artista para ir a su música. El corazón la guarda en favoritas y la etiqueta muestra la calidad del audio.',
  },
  { target: 'player.seek', title: 'Progreso', body: 'Arrastra para moverte por la canción.' },
  {
    target: 'player.controls',
    title: 'Controles',
    body: 'Aleatorio, anterior, reproducir o pausar, siguiente y repetir.',
  },
  ...TOOLS,
  {
    target: 'player.modes',
    title: 'Modos',
    body: 'Cambia entre carátula y visualizadores. El último botón muestra todos; con la estrella fijas los que quieras aquí.',
  },
];

export const TOURS: Record<TourId, TourStep[]> = {
  home: [
    {
      target: 'home.tabs',
      title: 'Dos bibliotecas',
      body: 'Biblioteca local tiene la música de tu teléfono. YouTube Music reproduce en streaming sin guardar nada.',
    },
    { target: 'home.search', title: 'Buscar', body: 'Busca entre tus canciones, álbumes y artistas.' },
    {
      target: 'home.settings',
      title: 'Ajustes',
      body: 'Color principal, forma de la carátula, letras, cassettes, Discord y más.',
    },
    {
      target: 'home.playlists',
      title: 'Tus listas',
      body: 'Crea una con el botón +. Cada lista lleva un cassette como portada, que puedes cambiar por otro estilo, uno tuyo o una imagen.',
    },
    {
      target: 'home.recent',
      title: 'Escuchado recientemente',
      body: 'Lo último que sonó, de tu teléfono y de YouTube juntos.',
    },
    {
      target: 'home.library',
      title: 'Biblioteca',
      body: 'Todas tus canciones por álbum, artista, género o carpeta. Mantén pulsada una canción para ver sus opciones.',
    },
    {
      target: 'mini',
      title: 'Lo que suena',
      body: 'Toca para abrir el reproductor con visualizadores, letras y cassette.',
    },
  ],
  youtube: [
    { target: 'home.tabs', title: 'YouTube Music', body: 'Escucha en streaming: necesita internet y no se descarga.' },
    { target: 'yt.search', title: 'Buscar', body: 'Canciones, artistas, álbumes y listas de YouTube Music.' },
    { target: 'yt.chips', title: 'Estados de ánimo', body: 'Filtra la portada por género o momento del día.' },
    {
      title: 'Opciones de cada canción',
      body: 'Mantén pulsada una canción para ponerla a continuación, añadirla a una lista, marcarla como favorita o cambiar su portada.',
    },
    { target: 'mini', title: 'Lo que suena', body: 'Toca para abrir el reproductor.' },
  ],
  player: [
    ...TOP,
    stage('Carátula, cassette, letras o visualizadores: cambia de modo con los botones de abajo.'),
    ...BOTTOM,
  ],
  cassette: [
    ...TOP,
    stage(
      'Toca el cassette para pausar o reanudar. Desliza de lado para avanzar o retroceder, como si giraras la cinta.',
    ),
    ...BOTTOM,
  ],
  lyrics: [
    ...TOP,
    stage('Las letras siguen la canción palabra por palabra. Toca una línea para saltar a ese momento.'),
    ...BOTTOM,
  ],
  maker: [
    {
      target: 'maker.preview',
      title: 'Vista previa',
      body: 'Así quedará tu cassette. Arrastra los stickers para colocarlos y tócalos para elegirlos.',
    },
    { target: 'maker.name', title: 'Nombre', body: 'El nombre con que aparece en la lista de estilos.' },
    {
      target: 'maker.tabs',
      title: 'Partes del cassette',
      body: 'Carcasa, etiqueta, degradados y stickers. Elige una parte para cambiarla.',
    },
    {
      target: 'maker.panel',
      title: 'Colores y stickers',
      body: 'Elige el color de cada zona o añade stickers, también desde tus imágenes.',
    },
    {
      target: 'maker.save',
      title: 'Guardar',
      body: 'Si estás editando uno tuyo, se actualiza; no se crea otro.',
    },
  ],
  jam: [
    {
      target: 'jam.code',
      title: 'Invita',
      body: 'Este es el código de la sala. Tócalo para compartir un enlace que abre la sala directamente.',
    },
    {
      target: 'jam.members',
      title: 'Quién está',
      body: 'La corona marca al anfitrión, que lleva la música. Si se va, la sala pasa a quien llegó primero.',
    },
    {
      target: 'jam.sync',
      title: 'Sincronización',
      body: 'Cada teléfono escucha por su cuenta y se ajusta solo al anfitrión, acelerando o frenando apenas, sin cortes.',
    },
    {
      target: 'jam.react',
      title: 'Reacciones',
      body: 'Toca la carita junto al chat y lanza un emoji: sale flotando en la pantalla de todos.',
    },
    {
      target: 'jam.tabs',
      title: 'Chat, cola y añadir',
      body: 'Habla con la sala, vota las canciones de la cola para que suenen antes y añade más desde YouTube Music.',
    },
  ],
  playlist: [
    {
      target: 'playlist.cover',
      title: 'Portada de la lista',
      body: 'Toca la cámara para poner una imagen, cambiar el estilo del cassette o crear uno solo para esta lista.',
    },
    {
      target: 'playlist.add',
      title: 'Añadir canciones',
      body: 'Elige canciones de tu teléfono para sumarlas a la lista.',
    },
    {
      title: 'Ordenar y quitar',
      body: 'Mantén pulsada una canción de la lista para quitarla o ver más opciones.',
    },
  ],
};
