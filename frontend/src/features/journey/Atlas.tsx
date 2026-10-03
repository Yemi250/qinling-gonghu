import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { SCENES, type Scene } from "./scenes";

type City = {
  properties: { name: string; center: number[] };
  geometry: { type: string; coordinates: number[][][][] | number[][][] };
};
type Place = Scene;
const PLACES: Place[] = Object.values(SCENES);
/** Offset only the artwork, preserving the geographic province outline. */
function landmarkPosition(place: Place): number[] {
  const [x, y] = project(place.location);
  return [x + place.mapOffset[0], y + place.mapOffset[1]];
}
/** Place the preview beside the artwork without covering another landmark or label. */
function previewPosition(place: Place): number[] {
  const [x, y] = landmarkPosition(place);
  const blocked = PLACES.map((p) => {
    const [px, py] = landmarkPosition(p);
    return [px - 72, py - 172, px + 72, py + 38];
  });
  const candidates = [
    [82, -110],
    [-305, -110],
    [82, -280],
    [-305, -280],
    [82, 48],
    [-110, 48],
    [-110, -280],
  ];
  const options = candidates.map(([dx, dy]) => [
    Math.max(15, Math.min(x + dx, 915)),
    Math.max(25, Math.min(y + dy, 670)),
  ]);
  return (
    options.find(
      ([cx, cy]) =>
        !blocked.some(
          ([left, top, right, bottom]) =>
            cx < right && cx + 218 > left && cy < bottom && cy + 95 > top,
        ),
    ) || options[0]
  );
}
/** Keep secondary city labels clear of the landmark illustrations. */
function cityLabelPosition(city: City): number[] {
  const [x, y] = project(city.properties.center);
  const candidates = [
    [0, 0],
    [-65, 0],
    [65, 0],
    [0, 50],
    [0, -50],
    [-65, 50],
    [65, 50],
  ];
  return (
    candidates
      .map(([dx, dy]) => [x + dx, y + dy])
      .find(([cx, cy]) =>
        PLACES.every((place) => {
          const [px, py] = landmarkPosition(place);
          return (
            cx + 35 < px - 72 ||
            cx - 35 > px + 72 ||
            cy + 15 < py - 172 ||
            cy - 20 > py + 38
          );
        }),
      ) || [x, y]
  );
}
/** Project real municipal geometry into a compact illustrated atlas. */
function project(p: readonly number[]): number[] {
  return [
    ((p[0] - 105.45) * 100 + 60) * 1.6 + 50,
    ((39.65 - p[1]) * 90 + 20) * 0.91 + 40,
  ];
}
/** Join municipal paths to draw the province's raised paper-and-clay foundation. */
function provincePath(cities: City[]): string {
  return cities.map(cityPath).join(" ");
}
function cityPath(city: City): string {
  const polygons =
    city.geometry.type === "Polygon"
      ? [city.geometry.coordinates]
      : city.geometry.coordinates;
  return (polygons as number[][][][])
    .map((poly) =>
      poly
        .map(
          (ring) =>
            ring
              .map((p, i) => `${i ? "L" : "M"}${project(p).join(",")}`)
              .join(" ") + " Z",
        )
        .join(" "),
    )
    .join(" ");
}
/** Hover and keyboard focus share the same destination preview. */
export function Atlas() {
  const [cities, setCities] = useState<City[]>([]);
  const [active, setActive] = useState(PLACES[0]);
  const [failed, setFailed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [noteX, noteY] = previewPosition(active);
  /** Keep the preview available while crossing from its landmark to the card. */
  function keepPreview(place?: Place) {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = null;
    if (place) setActive(place);
  }
  /** Restore the initial destination when pointer or keyboard focus leaves. */
  function restorePreview() {
    keepPreview();
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null;
      setActive(PLACES[0]);
    }, 150);
  }
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch("assets/shaanxi-cities.geojson", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => setCities(data.features))
      .catch((e) => {
        if (e.name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="atlas-layout">
      <div className="atlas-stage">
        <span className="atlas-north" aria-label="北方">
          北 <span>▲</span>
        </span>
        <svg
          className="atlas-map"
          viewBox="0 0 1160 790"
          aria-label="陕西十市漫游地图"
        >
          <defs>
            <clipPath id="province">
              {cities.map((c) => (
                <path key={c.properties.name} d={cityPath(c)} />
              ))}
            </clipPath>
          </defs>
          {[26, 6].map((depth, i) => (
            <g
              className={`map-foundation map-foundation--${i}`}
              key={depth}
              transform={`translate(0 ${depth})`}
            >
              <path d={provincePath(cities)} />
            </g>
          ))}
          <g clipPath="url(#province)">
            <image
              href="assets/atlas-terrain-v2.png"
              x="130"
              y="48"
              width="960"
              height="680"
              preserveAspectRatio="xMidYMid slice"
            />
            <rect
              x="0"
              y="0"
              width="1160"
              height="790"
              fill="#f6eee0"
              opacity=".04"
            />
          </g>
          <g className="city-boundaries">
            {cities.map((c) => (
              <path key={c.properties.name} d={cityPath(c)} />
            ))}
          </g>
          {cities
            .filter(
              (c) =>
                ![
                  "西安市",
                  "宝鸡市",
                  "渭南市",
                  "延安市",
                  "汉中市",
                  "榆林市",
                ].includes(c.properties.name),
            )
            .map((c) => {
              const [x, y] = cityLabelPosition(c);
              return (
                <g key={c.properties.name} transform={`translate(${x} ${y})`}>
                  <rect
                    className="city-label-paper"
                    x="-33"
                    y="-19"
                    width="66"
                    height="29"
                    rx="7"
                  />
                  <text className="city-label" x="0" y="2">
                    {c.properties.name.replace("市", "")}
                  </text>
                </g>
              );
            })}
          {[...PLACES]
            .sort((a, b) => b.location[1] - a.location[1])
            .map((p) => {
              const [x, y] = landmarkPosition(p);
              return (
                <g
                  key={p.name}
                  data-city={p.city}
                  className={`landmark ${active.name === p.name ? "is-active" : ""}`}
                  transform={`translate(${x} ${y})`}
                  onMouseEnter={() => keepPreview(p)}
                  onMouseLeave={restorePreview}
                  onFocus={() => keepPreview(p)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget))
                      restorePreview();
                  }}
                >
                  <foreignObject
                    x="-70"
                    y="-170"
                    width="140"
                    height="212"
                    className="landmark-window"
                  >
                    <div className="landmark-inner">
                      <Link
                        to={`/scenic/${p.slug}`}
                        aria-label={`进入${p.name}`}
                      >
                        <Landmark place={p} />
                      </Link>
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          <foreignObject
            className="atlas-callout"
            x={noteX}
            y={noteY}
            width="235"
            height="145"
            onMouseEnter={() => keepPreview()}
            onMouseLeave={restorePreview}
            onFocus={() => keepPreview()}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                restorePreview();
            }}
          >
            <aside
              className="destination-note"
              key={active.name}
              aria-label={`${active.name}目的地`}
            >
              <h2>{active.name}</h2>
              <Link to={`/scenic/${active.slug}`}>
                走进这处风景 <ArrowRight size={19} />
              </Link>
            </aside>
          </foreignObject>
        </svg>
        {failed && (
          <div className="atlas-load-error" role="alert">
            <p>地图暂时未加载，仍可直接开启景区篇章。</p>
            {PLACES.map((place) => (
              <Link key={place.slug} to={`/scenic/${place.slug}`}>
                {place.name} ↗
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function Landmark({ place: p }: { place: Place }) {
  return (
    <>
      <span className={`landmark-art landmark-art--${p.slug}`}>
        <img src={`assets/${p.landmarkImage}`} alt="" />
      </span>
      <span className="landmark-pin" />
      <span className="landmark-name">
        <i aria-hidden="true" />
        {p.city}
      </span>
    </>
  );
}
