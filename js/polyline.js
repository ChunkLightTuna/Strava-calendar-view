// Google encoded-polyline codec (the format Strava's summary_polyline uses).

export function decodePolyline(str) {
  const points = [];
  let lat = 0;
  let lng = 0;
  let i = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = str.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };
  while (i < str.length) {
    lat += next();
    lng += next();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export function encodePolyline(points) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const encode = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = '';
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return chunk + String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of points) {
    const rLat = Math.round(lat * 1e5);
    const rLng = Math.round(lng * 1e5);
    out += encode(rLat - prevLat) + encode(rLng - prevLng);
    prevLat = rLat;
    prevLng = rLng;
  }
  return out;
}
