/** Network error helpers: tell "no internet" apart from real failures. */

const OFFLINE =
  /unable to resolve host|unknownhost|no address associated|network is unreachable|failed to connect|timeout|timed out|connection (reset|refused|abort)|network request failed|sin conexi/i;

export const isOffline = (e: unknown) => OFFLINE.test(String((e as Error)?.message ?? e));

/** A short, human message for an error shown on screen. */
export function friendlyError(e: unknown): string {
  if (isOffline(e)) return 'Sin conexión a internet. Revisa tu Wi-Fi o datos y vuelve a intentarlo.';
  const msg = String((e as Error)?.message ?? e);
  return msg.length > 120 ? 'Algo salió mal al cargar. Inténtalo de nuevo.' : msg;
}
