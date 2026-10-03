/** One registry drives six chapters, map landmarks, search and scenic names. */
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
    location: [109.27, 34.38],
    mapOffset: [-15, 18],
    landmarkImage: "warrior.png",
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
    location: [107.77, 33.96],
    mapOffset: [-38, 12],
    landmarkImage: "landmark-taibai-v1.png",
  },
  huashan: {
    slug: "huashan",
    name: "华山",
    city: "渭南",
    scenicId: "huashan-demo",
    title: "向险峰，借一眼辽阔。",
    description:
      "沿石阶拾级而上，看云海漫过群峰。\n记住这一眼辽阔，\n也让山间的小径被温柔照看。",
    image: "huashan-v1",
    palette: "stone",
    location: [110.08, 34.49],
    mapOffset: [40, 18],
    landmarkImage: "landmark-huashan-v1.png",
  },
  baotashan: {
    slug: "baotashan",
    name: "宝塔山",
    city: "延安",
    scenicId: "baotashan-demo",
    title: "沿延河，听山城回响。",
    description:
      "黄土的纹理里，藏着山城的故事。\n走近古塔与河岸，\n留下记忆，也留下一份照看。",
    image: "baotashan-v1",
    palette: "loess",
    location: [109.49, 36.59],
    mapOffset: [-62, 0],
    landmarkImage: "landmark-baotashan-v1.png",
  },
  hanzhong: {
    slug: "hanzhong",
    name: "汉中油菜花海",
    city: "汉中",
    scenicId: "hanzhong-demo",
    title: "在花海，慢慢走一程。",
    description:
      "花田连着村落，春风越过远山。\n收藏山南的一抹金黄，\n也让这片田野的美延续下去。",
    image: "hanzhong-v1",
    palette: "field",
    location: [107.03, 33.07],
    mapOffset: [-20, 12],
    landmarkImage: "landmark-hanzhong-v1.png",
  },
  zhenbeitai: {
    slug: "zhenbeitai",
    name: "镇北台",
    city: "榆林",
    scenicId: "zhenbeitai-demo",
    title: "到长城，听风过边塞。",
    description:
      "风掠过城台，也掠过千年的边塞。\n看见石墙与远方，\n一起照看脚下这一段旅程。",
    image: "zhenbeitai-v1",
    palette: "sand",
    location: [109.74, 38.29],
    mapOffset: [24, 65],
    landmarkImage: "landmark-zhenbeitai-v1.png",
  },
} as const;
export type Scene = (typeof SCENES)[keyof typeof SCENES];
/** Unknown historical IDs remain readable rather than being mislabeled. */
export function scenicName(identifier: string): string {
  return (
    Object.values(SCENES).find((scene) => scene.scenicId === identifier)
      ?.name || identifier
  );
}
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
