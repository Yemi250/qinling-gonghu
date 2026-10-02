/** Two playable scenes share a notebook, but retain their own visual identity. */
export const SCENES = {
  terracotta: {
    slug: "terracotta",
    name: "兵马俑",
    city: "西安",
    scenicId: "terracotta-demo",
    title: "与千年，打个照面。",
    description:
      "陶土有温度，时间有回声。\n走近一排排沉默的守望者，\n也为这段旅程留下一点温柔。",
    image: "terracotta",
    palette: "clay",
  },
  taibai: {
    slug: "taibai",
    name: "太白山",
    city: "宝鸡",
    scenicId: "qinling-demo",
    title: "把脚步，交给山风。",
    description:
      "沿着山径向上，穿过林梢与云海。\n记录你遇见的美，\n也一起照看这座山。",
    image: "taibai",
    palette: "mist",
  },
} as const;
export type Scene = (typeof SCENES)[keyof typeof SCENES];
export type Receipt = {
  id: string;
  token: string;
  kind: "memory" | "care";
  scenic: string;
  title: string;
  image: string;
  date: string;
};
const RECEIPTS = "gonghu.journey.receipts.v1";
/** Credentials remain on this browser and never enter links or public feeds. */
export function readReceipts(): Receipt[] {
  try {
    const data = JSON.parse(localStorage.getItem(RECEIPTS) || "[]");
    return Array.isArray(data)
      ? data.filter(
          (r) =>
            r &&
            typeof r.id === "string" &&
            typeof r.token === "string" &&
            ["memory", "care"].includes(r.kind),
        )
      : [];
  } catch {
    return [];
  }
}
/** Throw on storage failure so a saved server record does not lose its receipt silently. */
export function saveReceipt(receipt: Receipt): void {
  localStorage.setItem(
    RECEIPTS,
    JSON.stringify([
      receipt,
      ...readReceipts().filter((r) => r.id !== receipt.id),
    ]),
  );
}
export function dateLabel(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
