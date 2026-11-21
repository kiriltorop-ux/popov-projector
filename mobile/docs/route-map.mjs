// Local OpenStreetMap-derived basemap, registered to the same Web Mercator bounds
// as the center map in «Город и реки».
const radians = Math.PI / 180;
const mercator = lat => Math.log(Math.tan(Math.PI / 4 + lat * radians / 2));
const north = mercator(56.350);
const south = mercator(56.300);
const project = ([lat, lon]) => [
  (lon - 43.935) / (44.075 - 43.935) * 1000,
  (north - mercator(lat)) / (north - south) * 644,
];

export function mapFrame(route, zoom) {
  const pins = route.coords.map(project);
  const path = route.path?.map(project) || [];
  const points = [...pins, ...path];
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const width = Math.max(186, right - left + 95) / zoom;
  const height = Math.max(205, bottom - top + 155) / zoom;
  const x = (left + right - width) / 2 + 7;
  const y = (top + bottom - height) / 2 - 16;
  const position = ([px, py]) => ({
    left: (px - x) / width * 100,
    top: (py - y) / height * 100,
  });
  return {
    viewBox: [x, y, width, height].join(' '),
    line: path.map(point => point.map(value => value.toFixed(2)).join(',')).join(' '),
    pins: pins.map(position),
    river: position(project([56.337, 44.003])),
  };
}
