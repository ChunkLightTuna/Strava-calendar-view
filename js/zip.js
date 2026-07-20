// Minimal ZIP reader for the Strava export archive. Reads only the central
// directory up front and extracts entries on demand via File.slice(), so a
// multi-hundred-MB archive never has to sit in memory.

const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

async function readBytes(file, start, len) {
  return new Uint8Array(await file.slice(start, start + len).arrayBuffer());
}

export async function openZip(file) {
  // EOCD is within the last 22 + 65535 (comment) bytes; add margin for the ZIP64 locator.
  const tailLen = Math.min(file.size, 22 + 65535 + 20);
  const tailStart = file.size - tailLen;
  const tail = await readBytes(file, tailStart, tailLen);
  const dv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record).');

  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locIdx = eocd - 20;
    if (locIdx >= 0 && dv.getUint32(locIdx, true) === ZIP64_LOCATOR_SIG) {
      const z64Offset = Number(dv.getBigUint64(locIdx + 8, true));
      const z = await readBytes(file, z64Offset, 56);
      const zdv = new DataView(z.buffer);
      if (zdv.getUint32(0, true) === ZIP64_EOCD_SIG) {
        count = Number(zdv.getBigUint64(32, true));
        cdSize = Number(zdv.getBigUint64(40, true));
        cdOffset = Number(zdv.getBigUint64(48, true));
      }
    }
  }

  const cd = await readBytes(file, cdOffset, cdSize);
  const cdv = new DataView(cd.buffer);
  const decoder = new TextDecoder();
  const entries = new Map();
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cdv.getUint32(p, true) !== CENTRAL_SIG) break;
    const method = cdv.getUint16(p + 10, true);
    let compressedSize = cdv.getUint32(p + 20, true);
    let size = cdv.getUint32(p + 24, true);
    const nameLen = cdv.getUint16(p + 28, true);
    const extraLen = cdv.getUint16(p + 30, true);
    const commentLen = cdv.getUint16(p + 32, true);
    let localOffset = cdv.getUint32(p + 42, true);
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen));

    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const id = cdv.getUint16(e, true);
        const len = cdv.getUint16(e + 2, true);
        if (id === 1) { // ZIP64 extended info, fields present only when maxed above
          let q = e + 4;
          if (size === 0xffffffff) { size = Number(cdv.getBigUint64(q, true)); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(cdv.getBigUint64(q, true)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(cdv.getBigUint64(q, true)); q += 8; }
          break;
        }
        e += 4 + len;
      }
    }

    entries.set(name, { name, method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  async function extract(name) {
    const entry = entries.get(name);
    if (!entry) throw new Error(`Not in archive: ${name}`);
    const head = await readBytes(file, entry.localOffset, 30);
    const hdv = new DataView(head.buffer);
    if (hdv.getUint32(0, true) !== LOCAL_SIG) throw new Error('Corrupt ZIP entry header.');
    const dataStart = entry.localOffset + 30 + hdv.getUint16(26, true) + hdv.getUint16(28, true);
    const blob = file.slice(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return new Uint8Array(await blob.arrayBuffer());
    if (entry.method === 8) {
      const stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error(`Unsupported ZIP compression method ${entry.method}.`);
  }

  return { file, entries, extract };
}
