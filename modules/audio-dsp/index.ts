import { requireOptionalNativeModule } from 'expo-modules-core';

type Native = {
  isSupported(): boolean;
  bandFrequencies(): number[];
  setEqualizer(player: object, enabled: boolean, preamp: number, gains: number[]): Promise<boolean>;
  setEffects(values: number[]): boolean;
};

const native = requireOptionalNativeModule<Native>('AudioDsp');

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const AudioDsp = {
  supported: !!native && native.isSupported(),
  setEqualizer: (player: object, enabled: boolean, preamp: number, gains: number[]) =>
    native ? native.setEqualizer(player, enabled, preamp, gains).catch(() => false) : Promise.resolve(false),
  /** Android only. [reverb, roomSize, echo, eightD, bass, filter (0 none · 1 lo-fi · 2 radio), karaoke] */
  setEffects: (values: number[]) => (native?.setEffects ? native.setEffects(values) : false),
};
