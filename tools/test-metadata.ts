// Dev-only: npx tsx tools/test-metadata.ts <files...> — prints parsed tags/stream info.
import { openSync, readSync, fstatSync } from 'node:fs';
import { parseMetadata } from '../src/library/metadata';

for (const path of process.argv.slice(2)) {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  const src = {
    size,
    read(offset: number, length: number) {
      const len = Math.max(0, Math.min(length, size - offset));
      const buf = new Uint8Array(len);
      readSync(fd, buf, 0, len, offset);
      return buf;
    },
  };
  const m = parseMetadata(src, path);
  const { picture, ...rest } = m;
  console.log(
    path.split('/').pop(),
    JSON.stringify({
      ...rest,
      picture:
        picture &&
        `${picture.mime} ${picture.data.length}B ${picture.data[0].toString(16)}${picture.data[1].toString(16)}`,
    }),
  );
}
