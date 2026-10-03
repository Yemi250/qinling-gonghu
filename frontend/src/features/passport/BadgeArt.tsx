import { useId } from "react";

/** Original vector medals: six motifs share restrained engraved-metal geometry. */
export function BadgeArt({ id, earned = true }: { id: string; earned?: boolean }) {
  const gradient = useId().replace(/:/g, "");
  const motifs: Record<string, React.ReactNode> = {
    departure: <><path d="m28 62 17-24 9 13 9-22 22 33H28Z"/><path d="m43 43 3 4 3-2m10-8 5 8 4-4"/></>,
    collector: <><path d="M30 42h13l5-8h20l5 8h10v32H30Z"/><circle cx="57" cy="57" r="13"/><circle cx="57" cy="57" r="7"/></>,
    wanderer: <><path d="M34 75c32-4-15-19 19-30s-5-14 21-20"/><circle cx="34" cy="75" r="4"/><circle cx="74" cy="25" r="4"/></>,
    guardian: <><path d="M57 80V46c0-14 14-18 23-17-1 17-9 25-23 25M57 62c-16 0-26-8-25-24 15 0 25 8 25 24"/><path d="m60 49 11-10M54 57 42 47"/></>,
    echo: <><circle cx="57" cy="55" r="6"/><path d="M42 41a20 20 0 0 0 0 28m30-28a20 20 0 0 1 0 28M34 33a31 31 0 0 0 0 44m46-44a31 31 0 0 1 0 44"/></>,
    "six-scenes": <><circle cx="57" cy="55" r="25"/><path d="m66 37-4 23-15 13 4-23 15-13Z"/><path d="M57 23v5m0 54v5M25 55h5m54 0h5"/></>,
  };
  return <svg className={`passport-badge-art ${earned ? "earned" : "locked"}`} viewBox="0 0 114 114" aria-hidden="true">
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e8dcc2"/><stop offset=".4" stopColor="#c9b698"/><stop offset=".7" stopColor="#9b8265"/><stop offset="1" stopColor="#ded1b7"/></linearGradient></defs>
    <path d="m57 5 13 9 16 1 8 14 14 8-1 17 3 14-12 11-6 15-17 2-18 13-14-10-17-1-7-15-14-10 2-17-3-15 12-11 5-16 18-2Z" fill={`url(#${gradient})`} stroke="#8f795f"/>
    <circle cx="57" cy="55" r="39" fill="#f5ecd9" fillOpacity=".72" stroke="#9d866b"/><circle cx="57" cy="55" r="34" fill="none" stroke="#ad987a" strokeDasharray="1 4"/>
    <g stroke="#755d46" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">{motifs[id] ?? motifs.departure}</g>
    <path d="M39 94h36" stroke="#80654d"/><circle cx="57" cy="94" r="2" fill="#80654d"/>
  </svg>;
}
