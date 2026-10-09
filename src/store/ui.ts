import { create } from 'zustand';

type UI = {
  /** Track whose action sheet is open. */
  actionsFor: string | null;
  /** When opened from inside a playlist: which one and at what position. */
  actionsCtx: { playlistId: string; index: number } | null;
  /** Track ids waiting for a playlist choice. */
  addToPlaylist: string[] | null;
  /** Open "Nueva lista" sheet, with the songs it should start with (empty: none). */
  newPlaylist: string[] | null;
  toast: string | null;
  openNewPlaylist: (ids?: string[]) => void;
  openActions: (id: string, ctx?: { playlistId: string; index: number }) => void;
  close: () => void;
  pickPlaylist: (ids: string[]) => void;
  showToast: (msg: string) => void;
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUI = create<UI>()((set) => ({
  actionsFor: null,
  actionsCtx: null,
  addToPlaylist: null,
  newPlaylist: null,
  toast: null,
  openNewPlaylist: (ids = []) => set({ actionsFor: null, addToPlaylist: null, newPlaylist: ids }),
  openActions: (id, ctx) => set({ actionsFor: id, actionsCtx: ctx ?? null }),
  close: () => set({ actionsFor: null, addToPlaylist: null, newPlaylist: null }),
  pickPlaylist: (ids) => set({ actionsFor: null, addToPlaylist: ids }),
  showToast: (toast) => {
    clearTimeout(toastTimer);
    set({ toast });
    toastTimer = setTimeout(() => set({ toast: null }), 2200);
  },
}));
