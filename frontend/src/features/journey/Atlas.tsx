import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight, Mountain, Compass } from "lucide-react";

type City = {
  properties: { name: string; center: number[] };
  geometry: { type: string; coordinates: number[][][][] | number[][][] };
};
type Place = {
  name: string;
  city: string;
  location: number[];
  slug?: string;
  symbol: string;
  description: string;
};
const PLACES: Place[] = [
  {
    name: "兵马俑",
    city: "西安",
    location: [109.27, 34.38],
    slug: "terracotta",
    symbol: "warrior",
    description: "走近陶土里的千年，看见长安的另一种温度。",
  },
  {
    name: "太白山",
    city: "宝鸡",
    location: [107.77, 33.96],
    slug: "taibai",
    symbol: "mountain",
    description: "从关中平原出发，去听秦岭云海与山风的声音。",
  },
  {
    name: "华山",
    city: "渭南",
    location: [110.08, 34.49],
    symbol: "peak",
    description: "险峰与云阶。这个目的地的互动篇章正在筹备。",
  },
  {
    name: "宝塔山",
    city: "延安",
    location: [109.49, 36.59],
    symbol: "pagoda",
    description: "黄土与延河之间。这个目的地的互动篇章正在筹备。",
  },
  {
    name: "汉中",
    city: "汉中",
    location: [107.03, 33.07],
    symbol: "flower",
    description: "山南的田野与花海。这个目的地的互动篇章正在筹备。",
  },
  {
    name: "镇北台",
    city: "榆林",
    location: [109.74, 38.29],
    symbol: "tower",
    description: "长城遇见大漠。这个目的地的互动篇章正在筹备。",
  },
];
/** Project real municipal geometry into a compact illustrated atlas. */
function project(p: number[]): number[] {
  return [(p[0] - 105.45) * 100 + 60, (39.65 - p[1]) * 90 + 20];
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
        <span className="atlas-north">
          N <span>↑</span>
        </span>
        <svg
          className="atlas-map"
          viewBox="0 0 660 780"
          aria-label="陕西十市漫游地图"
        >
          <defs>
            <clipPath id="province">
              {cities.map((c) => (
                <path key={c.properties.name} d={cityPath(c)} />
              ))}
            </clipPath>
          </defs>
          <g className="map-foundation" transform="translate(0 12)">
            {cities.map((c) => (
              <path key={c.properties.name} d={cityPath(c)} />
            ))}
          </g>
          <g clipPath="url(#province)">
            <image
              href="assets/terrain.png"
              x="40"
              y="12"
              width="575"
              height="750"
              preserveAspectRatio="xMidYMid slice"
            />
            <rect
              x="0"
              y="0"
              width="660"
              height="780"
              fill="#f6eee0"
              opacity=".14"
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
              const [x, y] = project(c.properties.center);
              return (
                <text
                  className="city-label"
                  key={c.properties.name}
                  x={x}
                  y={y}
                >
                  {c.properties.name.replace("市", "")}
                </text>
              );
            })}
          {PLACES.map((p) => {
            const [x, y] = project(p.location);
            return (
              <g
                key={p.name}
                className={`landmark ${active.name === p.name ? "is-active" : ""}`}
                transform={`translate(${x} ${y})`}
              >
                <foreignObject x="-47" y="-103" width="94" height="151">
                  <div className="landmark-inner">
                    {p.slug ? (
                      <Link
                        to={`/scenic/${p.slug}`}
                        onMouseEnter={() => setActive(p)}
                        onFocus={() => setActive(p)}
                        aria-label={`进入${p.name}`}
                      >
                        <Landmark place={p} />
                      </Link>
                    ) : (
                      <button
                        onMouseEnter={() => setActive(p)}
                        onFocus={() => setActive(p)}
                        onClick={() => setActive(p)}
                        aria-label={`了解${p.name}`}
                      >
                        <Landmark place={p} />
                      </button>
                    )}
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
        {failed && <p role="alert">地图暂时未加载，可从右侧进入景区。</p>}
        <span className="atlas-caption">一幅山河，许多种相遇。</span>
      </div>
      <aside className="destination-note" key={active.name}>
        <span className="eyebrow">
          <Compass size={14} /> 漫游下一站
        </span>
        <span className="note-city">{active.city} / SHAANXI</span>
        <h2>{active.name}</h2>
        <p>{active.description}</p>
        {active.slug ? (
          <Link className="ink-link" to={`/scenic/${active.slug}`}>
            走进这一程 <ArrowUpRight size={18} />
          </Link>
        ) : (
          <span className="planned-label">互动篇章 · 筹备中</span>
        )}
        <div className="note-divider" />
        <p className="note-small">
          遇见风景，留下记忆。
          <br />
          发现需要照看的地方，
          <br />
          也可以顺手帮一把。
        </p>
        <Link
          className="map-secondary"
          to={`/scenic/${active.slug === "taibai" ? "terracotta" : "taibai"}`}
        >
          {active.slug === "taibai" ? "也去看看兵马俑" : "也去看看太白山"}{" "}
          <ArrowUpRight size={14} />
        </Link>
      </aside>
    </div>
  );
}
function Landmark({ place: p }: { place: Place }) {
  return (
    <>
      <span className={`landmark-art landmark-art--${p.symbol}`}>
        {p.symbol === "warrior" ? (
          <img src="assets/warrior.png" alt="" />
        ) : p.symbol === "mountain" || p.symbol === "peak" ? (
          <Mountain size={p.symbol === "peak" ? 48 : 62} strokeWidth={1.2} />
        ) : p.symbol === "flower" ? (
          <span>✿</span>
        ) : (
          <svg viewBox="0 0 70 80" aria-hidden="true">
            <path
              d={
                p.symbol === "pagoda"
                  ? "M35 4 L16 22 L25 22 L25 31 L10 43 L23 43 L23 54 L5 68 L27 68 L27 77 L44 77 L44 68 L65 68 L48 54 L48 43 L61 43 L45 31 L45 22 L54 22 Z"
                  : "M8 28 H17 V17 H27 V28 H43 V17 H53 V28 H62 V76 H8 Z"
              }
              fill="currentColor"
            />
          </svg>
        )}
      </span>
      <span className="landmark-pin" />
      <span className="landmark-name">
        {p.name}
        <small>{p.city}</small>
      </span>
    </>
  );
}
