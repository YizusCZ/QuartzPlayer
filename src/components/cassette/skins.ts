export type CassetteSkinId =
  | 'magenta'
  | 'sunset'
  | 'metal'
  | 'crystal'
  | 'noir'
  | 'vapor'
  | 'jade'
  | 'retro'
  | 'ocean'
  | 'sakura'
  | 'lime'
  | 'chrome';

export type CassetteSkin = {
  id: CassetteSkinId;
  name: string;
  /** Moulded shell: mid tone and the lit tone it drifts toward top-left. */
  shell: string;
  shellLight: string;
  /** Shell translucency (crystal / Type I shells let the rollers show through). */
  rollers: boolean;
  paper: string;
  ink: string;
  inkSoft: string;
  stripe: [string, string];
  sideInk: string;
  band: [string, string];
  brandInk: string;
  modelInk: string;
  arrow: string;
  typeLine: string;
  prefix: string;
  window: [string, string];
  pane: string;
};

export const SKINS: Record<CassetteSkinId, CassetteSkin> = {
  // Photo ref 1–2: taupe moulding, white label, hot-magenta foil.
  magenta: {
    id: 'magenta',
    name: 'Magenta · Type II',
    shell: '#5F5A50',
    shellLight: '#8C8679',
    rollers: false,
    paper: '#F2F1ED',
    ink: '#3B3A3C',
    inkSoft: '#8A8886',
    stripe: ['#E54BC8', '#C92FA6'],
    sideInk: '#8E5C86',
    band: ['#E6E5E2', '#C9C8C4'],
    brandInk: '#4A4850',
    modelInk: '#4A4850',
    arrow: '#D93FBE',
    typeLine: 'TYPE II (HIGH) POSITION      HIGH BIAS 70µs EQ',
    prefix: 'QX',
    window: ['#5A5146', '#3A342D'],
    pane: '#B7AE9F',
  },
  // Photo ref 3: warmer translucent smoke, orange foil, orange model code.
  sunset: {
    id: 'sunset',
    name: 'Sunset · Type I',
    shell: '#7A7163',
    shellLight: '#A89E8D',
    rollers: true,
    paper: '#F4F3EF',
    ink: '#3A3936',
    inkSoft: '#8C8983',
    stripe: ['#FF6A2E', '#EE4E1C'],
    sideInk: '#9A4A2A',
    band: ['#EFEEEA', '#D3D1CC'],
    brandInk: '#46443F',
    modelInk: '#EE5220',
    arrow: '#F2582A',
    typeLine: 'TYPE I (NORMAL) POSITION      120µs EQ',
    prefix: 'QF',
    window: ['#5E5446', '#3C352C'],
    pane: '#BDB3A2',
  },
  // Metal formulation: graphite moulding, black label, champagne foil.
  metal: {
    id: 'metal',
    name: 'Graphite · Type IV Metal',
    shell: '#34343A',
    shellLight: '#5A5A62',
    rollers: false,
    paper: '#1F1F22',
    ink: '#E4DFD4',
    inkSoft: '#8F8A80',
    stripe: ['#D7BC7E', '#A98A4C'],
    sideInk: '#6B5629',
    band: ['#2B2B2F', '#1C1C1F'],
    brandInk: '#D9C38F',
    modelInk: '#D9C38F',
    arrow: '#CFAF68',
    typeLine: 'TYPE IV (METAL) POSITION      70µs EQ',
    prefix: 'QM',
    window: ['#2E2E33', '#1A1A1D'],
    pane: '#8E8A84',
  },
  // Clear smoke shell with a cobalt foil.
  crystal: {
    id: 'crystal',
    name: 'Crystal · Type II',
    shell: '#66737C',
    shellLight: '#9AA7AF',
    rollers: true,
    paper: '#F1F3F4',
    ink: '#2F3A42',
    inkSoft: '#85919A',
    stripe: ['#3E8FE0', '#2468B6'],
    sideInk: '#2B557F',
    band: ['#E5E9EC', '#C7CED3'],
    brandInk: '#35434D',
    modelInk: '#2468B6',
    arrow: '#3E8FE0',
    typeLine: 'TYPE II (HIGH) POSITION      CHROME 70µs EQ',
    prefix: 'QC',
    window: ['#48545C', '#2C353B'],
    pane: '#AEB6BA',
  },
  // Jet-black moulding, white label, signal-red foil.
  noir: {
    id: 'noir',
    name: 'Noir · Type II',
    shell: '#1E1E21',
    shellLight: '#3A3A3F',
    rollers: false,
    paper: '#F3F2EE',
    ink: '#1F1E20',
    inkSoft: '#8B8986',
    stripe: ['#E5383B', '#B81F25'],
    sideInk: '#8C2A2C',
    band: ['#E7E6E2', '#CBCAC6'],
    brandInk: '#262528',
    modelInk: '#C62A2F',
    arrow: '#E5383B',
    typeLine: 'TYPE II (HIGH) POSITION      HIGH BIAS 70µs EQ',
    prefix: 'QN',
    window: ['#2A2A2E', '#141416'],
    pane: '#8F8C88',
  },
  // Lavender translucent shell, aqua-to-pink foil.
  vapor: {
    id: 'vapor',
    name: 'Vaporwave · Type I',
    shell: '#8C7AA8',
    shellLight: '#BBA9D6',
    rollers: true,
    paper: '#F6F1FA',
    ink: '#3B2F4C',
    inkSoft: '#9286A3',
    stripe: ['#3FE0D0', '#FF71CE'],
    sideInk: '#8E4C9E',
    band: ['#EFE8F5', '#D6CBE2'],
    brandInk: '#43365A',
    modelInk: '#D9479F',
    arrow: '#FF71CE',
    typeLine: 'TYPE I (NORMAL) POSITION      120µs EQ',
    prefix: 'QV',
    window: ['#6A5A86', '#433759'],
    pane: '#C9BEDC',
  },
  // Deep green smoke with a gold foil.
  jade: {
    id: 'jade',
    name: 'Jade · Type II',
    shell: '#2F5A4C',
    shellLight: '#4F8572',
    rollers: true,
    paper: '#F1F2EC',
    ink: '#24352F',
    inkSoft: '#7F8E86',
    stripe: ['#E2BE62', '#B8933A'],
    sideInk: '#7A6224',
    band: ['#E6E8E1', '#C9CDC3'],
    brandInk: '#2B3F37',
    modelInk: '#A9852F',
    arrow: '#D3AE52',
    typeLine: 'TYPE II (HIGH) POSITION      CHROME 70µs EQ',
    prefix: 'QJ',
    window: ['#2A4A3F', '#18302A'],
    pane: '#9FB2A8',
  },
  // 70s cream shell, chocolate label and sunset stripes.
  retro: {
    id: 'retro',
    name: 'Retro 70s · Type I',
    shell: '#D9CBB0',
    shellLight: '#F1E6CF',
    rollers: false,
    paper: '#4A3427',
    ink: '#F5E7CF',
    inkSoft: '#C2A98C',
    stripe: ['#F2A33A', '#D9572B'],
    sideInk: '#F2C27A',
    band: ['#5A4030', '#3E2B20'],
    brandInk: '#F2C27A',
    modelInk: '#F2A33A',
    arrow: '#F2A33A',
    typeLine: 'TYPE I (NORMAL) POSITION      120µs EQ',
    prefix: 'QR',
    window: ['#A8977A', '#7C6D55'],
    pane: '#CFC2A8',
  },
  // Navy translucent shell, cyan foil.
  ocean: {
    id: 'ocean',
    name: 'Océano · Type II',
    shell: '#22344F',
    shellLight: '#3E5A80',
    rollers: true,
    paper: '#EEF3F7',
    ink: '#1D2B3C',
    inkSoft: '#7C8A99',
    stripe: ['#33D1FF', '#1592C7'],
    sideInk: '#1E5F80',
    band: ['#E2EAF0', '#C3D0DA'],
    brandInk: '#22344A',
    modelInk: '#1592C7',
    arrow: '#33C3F2',
    typeLine: 'TYPE II (HIGH) POSITION      CHROME 70µs EQ',
    prefix: 'QO',
    window: ['#1F3049', '#111C2C'],
    pane: '#8EA3B8',
  },
  // Pastel pink shell, rose foil.
  sakura: {
    id: 'sakura',
    name: 'Sakura · Type I',
    shell: '#D8A6B4',
    shellLight: '#F2CBD5',
    rollers: true,
    paper: '#FFF7F8',
    ink: '#5A3341',
    inkSoft: '#B0899A',
    stripe: ['#FF8FB1', '#E85D8A'],
    sideInk: '#A8496B',
    band: ['#FBEDF0', '#EBD3DA'],
    brandInk: '#6A3D4D',
    modelInk: '#E85D8A',
    arrow: '#FF7FA6',
    typeLine: 'TYPE I (NORMAL) POSITION      120µs EQ',
    prefix: 'QS',
    window: ['#B98593', '#8E5F6C'],
    pane: '#E8C6CF',
  },
  // Neon lime Type I, black label.
  lime: {
    id: 'lime',
    name: 'Neón lima · Type I',
    shell: '#7FA82A',
    shellLight: '#B3DB4F',
    rollers: true,
    paper: '#151615',
    ink: '#E9F5C9',
    inkSoft: '#8E9A78',
    stripe: ['#C6FF3D', '#8BD11A'],
    sideInk: '#C6FF3D',
    band: ['#222420', '#161715'],
    brandInk: '#C6FF3D',
    modelInk: '#C6FF3D',
    arrow: '#B9F536',
    typeLine: 'TYPE I (NORMAL) POSITION      120µs EQ',
    prefix: 'QL',
    window: ['#5D7B1E', '#3B4F12'],
    pane: '#B8C99A',
  },
  // Brushed silver shell, black label, ruby foil.
  chrome: {
    id: 'chrome',
    name: 'Chrome · Type IV Metal',
    shell: '#9EA2A8',
    shellLight: '#D7DADE',
    rollers: false,
    paper: '#18181B',
    ink: '#EDEDEF',
    inkSoft: '#9A9AA0',
    stripe: ['#E0115F', '#A10D45'],
    sideInk: '#E0115F',
    band: ['#26262A', '#18181B'],
    brandInk: '#E8E8EC',
    modelInk: '#F0457F',
    arrow: '#E0115F',
    typeLine: 'TYPE IV (METAL) POSITION      70µs EQ',
    prefix: 'QX4',
    window: ['#6E7278', '#4A4D52'],
    pane: '#B5B8BC',
  },
};

/** Standard tape lengths, picked from the track duration for the printed model number. */
export function tapeLength(durationSec: number): number {
  const needed = (durationSec / 60) * 2; // one side holds half the tape
  return [46, 54, 60, 74, 90, 100, 110].find((m) => m >= needed) ?? 120;
}

export function modelCode(skin: CassetteSkinId, durationSec: number): string {
  return `${SKINS[skin].prefix} ${tapeLength(durationSec)}`;
}
