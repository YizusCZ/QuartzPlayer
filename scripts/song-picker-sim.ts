/**
 * How often a game repeats songs from recent games: the old way (shuffle the
 * first playlists found, no memory) against src/lib/songPicker.ts.
 *
 *   npx tsx scripts/song-picker-sim.ts
 *
 * A synthetic category: 6 overlapping playlists of 80 songs, where the search
 * always ranks the same two first. Measures shape, not real YouTube results.
 */
import { dedupe, days, isOneSong, pick, weightedSample, type PoolSong } from '../src/lib/songPicker';

const GAMES = 30;
const NEED = 14;
const ARTISTS = 60;
const song = (i: number): PoolSong => ({
  videoId: `v${i}`,
  title: `Song ${i}`,
  artist: `Artist ${i % ARTISTS}`,
  duration: 200,
});
const lists = Array.from({ length: 6 }, (_, l) => Array.from({ length: 80 }, (_, i) => song(l * 45 + i)));
const shuffle = <T>(a: T[]) => [...a].sort(() => Math.random() - 0.5);

function oldGame(): PoolSong[] {
  return shuffle(dedupe([...shuffle(lists[0]), ...shuffle(lists[1])])).slice(0, NEED);
}

const heard: Record<string, number> = {};
let now = Date.now();
function newGame(): PoolSong[] {
  const chosen = weightedSample(
    lists.map((item, i) => ({ item, weight: 1 / (1 + i * 0.25) })),
    3,
  );
  return pick(chosen.flat().filter(isOneSong), NEED, {
    lastHeard: (id) => heard[id],
    now,
    maxPerArtist: 2,
    freshAfterMs: days(45),
    randomness: 1,
  });
}

function run(game: () => PoolSong[], remember: boolean) {
  const past: Set<string>[] = [];
  let repeats = 0;
  let total = 0;
  let maxArtist = 0;
  for (let g = 0; g < GAMES; g++) {
    const songs = game();
    const recent = new Set(past.slice(-5).flatMap((p) => [...p]));
    const counts = new Map<string, number>();
    for (const s of songs) {
      total++;
      if (recent.has(s.videoId)) repeats++;
      counts.set(s.artist, (counts.get(s.artist) ?? 0) + 1);
      if (remember) heard[s.videoId] = now;
    }
    maxArtist = Math.max(maxArtist, ...counts.values());
    past.push(new Set(songs.map((s) => s.videoId)));
    now += 3_600_000;
  }
  return `${((repeats / total) * 100).toFixed(1)}% de canciones ya oídas en las 5 partidas anteriores · máx. ${maxArtist} del mismo artista por partida`;
}

console.log(`${GAMES} partidas de ${NEED} canciones`);
console.log('Antes: ', run(oldGame, false));
console.log('Ahora: ', run(newGame, true));
