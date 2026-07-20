// Turn the route files inside a Strava export (GPX, TCX, FIT — possibly
// gzipped) into an encoded polyline for the detail map. Regex-based XML
// extraction is used instead of DOMParser so this also runs under Node for
// tests; GPX/TCX from Strava are machine-generated and regular.

import { encodePolyline } from './polyline.js';

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseGpx(text) {
  const points = [];
  for (const tag of text.matchAll(/<trkpt\b[^>]*>/g)) {
    const lat = /\blat="(-?[\d.]+)"/.exec(tag[0]);
    const lon = /\blon="(-?[\d.]+)"/.exec(tag[0]);
    if (lat && lon) points.push([Number(lat[1]), Number(lon[1])]);
  }
  return points;
}

function parseTcx(text) {
  const points = [];
  for (const pos of text.matchAll(/<Position>([\s\S]*?)<\/Position>/g)) {
    const lat = /<LatitudeDegrees>(-?[\d.]+)</.exec(pos[1]);
    const lon = /<LongitudeDegrees>(-?[\d.]+)</.exec(pos[1]);
    if (lat && lon) points.push([Number(lat[1]), Number(lon[1])]);
  }
  return points;
}

// Minimal FIT decoder: walks the record stream and pulls position_lat/long
// (fields 0/1, sint32 semicircles) out of "record" messages (global 20).
// Anything unexpected aborts with whatever points were collected so far.
function parseFit(bytes) {
  if (bytes.length < 14) return [];
  if (!(bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54)) return []; // ".FIT"
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0];
  const end = Math.min(headerSize + dv.getUint32(4, true), bytes.length);
  const defs = new Map();
  const points = [];
  const SEMI = 180 / 2147483648;

  const readData = (def, pos) => {
    if (pos + def.dataSize > end) return end; // truncated — stop
    let lat = null;
    let lon = null;
    let q = pos;
    for (const f of def.fields) {
      if (def.globalNum === 20 && (f.num === 0 || f.num === 1) && f.size === 4) {
        const v = dv.getInt32(q, def.little);
        if (v !== 0x7fffffff) {
          if (f.num === 0) lat = v * SEMI; else lon = v * SEMI;
        }
      }
      q += f.size;
    }
    if (lat != null && lon != null) points.push([lat, lon]);
    return pos + def.dataSize;
  };

  let p = headerSize;
  while (p < end) {
    const hdr = bytes[p++];
    if (hdr & 0x80) { // compressed-timestamp data message
      const def = defs.get((hdr >> 5) & 0x3);
      if (!def) break;
      p = readData(def, p);
    } else if (hdr & 0x40) { // definition message
      if (p + 5 > end) break;
      const local = hdr & 0xf;
      const hasDev = Boolean(hdr & 0x20);
      const little = bytes[p + 1] === 0;
      const globalNum = dv.getUint16(p + 2, little);
      const numFields = bytes[p + 4];
      p += 5;
      const fields = [];
      let dataSize = 0;
      for (let i = 0; i < numFields && p + 3 <= end; i++) {
        fields.push({ num: bytes[p], size: bytes[p + 1] });
        dataSize += bytes[p + 1];
        p += 3;
      }
      if (hasDev) {
        const numDev = bytes[p++] ?? 0;
        for (let i = 0; i < numDev && p + 3 <= end; i++) {
          dataSize += bytes[p + 1];
          p += 3;
        }
      }
      defs.set(local, { little, globalNum, fields, dataSize });
    } else { // normal data message
      const def = defs.get(hdr & 0xf);
      if (!def) break;
      p = readData(def, p);
    }
  }
  return points;
}

function toPolyline(points) {
  const clean = points.filter(([lat, lon]) =>
    Number.isFinite(lat) && Number.isFinite(lon) && (Math.abs(lat) > 1e-6 || Math.abs(lon) > 1e-6));
  if (clean.length < 2) return null;
  const MAX = 250;
  const stride = Math.max(1, Math.ceil(clean.length / MAX));
  const sampled = clean.filter((_, i) => i % stride === 0);
  if (sampled[sampled.length - 1] !== clean[clean.length - 1]) sampled.push(clean[clean.length - 1]);
  return encodePolyline(sampled);
}

// filename: the CSV's "Filename" value, e.g. "activities/12345.fit.gz"
export async function routeFromFile(filename, bytes) {
  let data = bytes;
  let name = filename.toLowerCase();
  if (name.endsWith('.gz')) {
    data = await gunzip(data);
    name = name.slice(0, -3);
  }
  if (name.endsWith('.fit')) return toPolyline(parseFit(data));
  const text = new TextDecoder().decode(data);
  if (name.endsWith('.gpx')) return toPolyline(parseGpx(text));
  if (name.endsWith('.tcx')) return toPolyline(parseTcx(text));
  return null;
}
