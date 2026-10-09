import { create } from 'zustand';

/** Transient scan progress. Kept out of the persisted library store so progress ticks never hit disk. */
export type ScanState = { running: boolean; done: number; total: number; message?: string };

export const useScan = create<ScanState>()(() => ({ running: false, done: 0, total: 0 }));
