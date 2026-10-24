import { requireOptionalNativeModule } from 'expo-modules-core';

type Native = {
  isSupported(): boolean;
  bandFrequencies(): number[];
  setEqualizer(
    player: object,
    enabled: boolean,
    preamp: number,
    gains: number[],
    balance: number,
    leveling: number,
  ): Promise<boolean>;
  setEffects(values: number[]): boolean;
};

const native = requireOptionalNativeModule<Native>('AudioDsp');

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const AudioDsp = {
  supported: !!native && native.isSupported(),
  /** `balance` −1 (left) … 1 (right); `leveling` 0 (off) … 1 (strong compression). */
  setEqualizer: (player: object, enabled: boolean, preamp: number, gains: number[], balance = 0, leveling = 0) =>
    native
      ? native.setEqualizer(player, enabled, preamp, gains, balance, leveling).catch(() => false)
      : Promise.resolve(false),
  /** Android only. [reverb, roomSize, echo, eightD, bass, filter (0 none · 1 lo-fi · 2 radio), karaoke] */
  setEffects: (values: number[]) => (native?.setEffects ? native.setEffects(values) : false),
};
