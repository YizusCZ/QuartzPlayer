import type { IconName } from '@/components/ui/Icon';

/**
 * What a room game can be about. Each category is a few YouTube Music
 * searches: the first public playlists they find give the songs.
 */
export type GameCategory = { id: string; name: string; icon: IconName; color: string; queries: string[] };

export const GAME_CATEGORIES: GameCategory[] = [
  {
    id: 'anime',
    name: 'Anime',
    icon: 'sword-cross',
    color: '#F107A3',
    queries: ['anime openings', 'anime songs hits'],
  },
  {
    id: 'rock-classic',
    name: 'Rock clásico',
    icon: 'guitar-electric',
    color: '#F08A24',
    queries: ['classic rock hits', 'rock clásico 70s 80s'],
  },
  {
    id: 'rock-alt',
    name: 'Rock alternativo',
    icon: 'lightning-bolt',
    color: '#7B2FF7',
    queries: ['alternative rock hits', '90s alternative rock'],
  },
  {
    id: 'rock-es',
    name: 'Rock en español',
    icon: 'guitar-acoustic',
    color: '#FF5A5F',
    queries: ['rock en español clásicos', 'rock latino'],
  },
  {
    id: 'reggaeton',
    name: 'Reggaetón',
    icon: 'fire',
    color: '#FFBF69',
    queries: ['reggaeton hits', 'reggaeton clásico'],
  },
  {
    id: 'pop-latino',
    name: 'Pop latino',
    icon: 'palm-tree',
    color: '#2EC4B6',
    queries: ['pop latino éxitos', 'pop en español'],
  },
  { id: 'pop-2000', name: 'Pop de los 2000', icon: 'cassette', color: '#4FB3E8', queries: ['2000s pop hits'] },
  { id: '80s', name: 'Los 80', icon: 'record-player', color: '#F107A3', queries: ['80s hits', 'éxitos de los 80'] },
  { id: 'kpop', name: 'K-Pop', icon: 'star-four-points', color: '#C9A8FF', queries: ['kpop hits', 'kpop girl groups'] },
  {
    id: 'hiphop',
    name: 'Hip-hop',
    icon: 'microphone-variant',
    color: '#9BE15D',
    queries: ['hip hop classics', 'rap hits'],
  },
  {
    id: 'electronic',
    name: 'Electrónica',
    icon: 'headphones',
    color: '#4FB3E8',
    queries: ['edm hits', 'electronic dance hits'],
  },
  {
    id: 'ballads',
    name: 'Baladas',
    icon: 'heart-multiple',
    color: '#FF5A5F',
    queries: ['baladas románticas en español', 'baladas pop'],
  },
  {
    id: 'movies',
    name: 'Películas y Disney',
    icon: 'movie-open',
    color: '#FFBF69',
    queries: ['disney songs', 'movie soundtrack hits'],
  },
  {
    id: 'games',
    name: 'Videojuegos',
    icon: 'gamepad-variant',
    color: '#9BE15D',
    queries: ['video game music', 'video game soundtrack'],
  },
  { id: 'indie', name: 'Indie', icon: 'shimmer', color: '#2EC4B6', queries: ['indie hits', 'indie pop'] },
];

/** A category from your own words ("Bad Bunny", "cumbia", "rock de los 90"). */
export const customCategory = (text: string): GameCategory => ({
  id: `custom:${text.toLowerCase()}`,
  name: text,
  icon: 'pencil',
  color: '#F08A24',
  queries: [text, `${text} hits`],
});
