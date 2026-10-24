import { useLocalSearchParams } from 'expo-router';
import { YouTubeHome, type SearchFilter } from '@/youtube/YouTubeHome';

/** YouTube Music as its own screen (the home tab embeds the same view). `q` opens it on a search. */
export default function YouTube() {
  const { q, filter } = useLocalSearchParams<{ q?: string; filter?: SearchFilter }>();
  return <YouTubeHome initialQuery={q} initialFilter={filter} />;
}
