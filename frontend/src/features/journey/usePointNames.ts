import { useEffect, useState } from "react";
import { api } from "../../api/client";

/** Read configured point names rather than presenting internal identifiers to visitors. */
export function usePointNames() {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    api.overview().then(data => {
      if (live) setNames(Object.fromEntries(data.points.map(p => [p.id, p.name])));
    }).catch(() => { /* Existing scene names remain a readable fallback. */ });
    return () => { live = false; };
  }, []);
  return (id: string, fallback: string) => names[id] || fallback;
}
