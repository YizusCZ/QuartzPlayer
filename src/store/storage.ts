import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * zustand's persist middleware writes on every `set`. The player store changes
 * 4×/s and the library store can hold thousands of tracks, so writes are
 * coalesced: the latest state is serialised once, shortly after a burst ends,
 * and skipped entirely when the payload did not change.
 */
const DELAY = 800;

// Never lose a pending write when the app goes to the background.
const flushers = new Set<() => void>();
AppState.addEventListener('change', (state) => {
  if (state !== 'active') flushers.forEach((f) => f());
});

export function persistStorage<T>(): PersistStorage<T> {
  const last = new Map<string, string>();
  const pending = new Map<string, StorageValue<T>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const seen = new Map<string, Record<string, unknown>>();

  const flush = (name: string) => {
    timers.delete(name);
    const value = pending.get(name);
    pending.delete(name);
    if (!value) return;
    const json = JSON.stringify(value);
    if (last.get(name) === json) return;
    last.set(name, json);
    void AsyncStorage.setItem(name, json);
  };

  flushers.add(() => {
    for (const name of [...pending.keys()]) {
      clearTimeout(timers.get(name));
      flush(name);
    }
  });

  return {
    getItem: async (name) => {
      const json = await AsyncStorage.getItem(name);
      if (json == null) return null;
      last.set(name, json);
      return JSON.parse(json) as StorageValue<T>;
    },
    setItem: (name, value) => {
      // persist() calls this on every set (4×/s for the player). When none of
      // the persisted fields changed identity there is nothing new to write,
      // so skip it before paying for a serialisation of the whole queue.
      const state = value.state as Record<string, unknown>;
      const prev = seen.get(name);
      if (prev && Object.keys(state).length === Object.keys(prev).length) {
        if (Object.keys(state).every((k) => state[k] === prev[k])) return;
      }
      seen.set(name, state);
      pending.set(name, value);
      if (!timers.has(name))
        timers.set(
          name,
          setTimeout(() => flush(name), DELAY),
        );
    },
    removeItem: async (name) => {
      last.delete(name);
      seen.delete(name);
      pending.delete(name);
      await AsyncStorage.removeItem(name);
    },
  };
}
