export type ConflictVisualKind =
  | "missile"
  | "drone"
  | "airstrike"
  | "explosion"
  | "ground"
  | "maritime"
  | "protest"
  | "cyber"
  | "political"
  | "generic";

export function conflictVisualKindFromType(type: string): ConflictVisualKind {
  const t = (type || "").toLowerCase();
  if (t.includes("missile") || t.includes("rocket")) return "missile";
  if (t.includes("drone")) return "drone";
  if (t.includes("airstrike") || t.includes("strike")) return "airstrike";
  if (t.includes("bomb") || t.includes("explos")) return "explosion";
  if (t.includes("clash") || t.includes("ground") || t.includes("ambush") || t.includes("shoot")) return "ground";
  if (t.includes("maritime")) return "maritime";
  if (t.includes("protest")) return "protest";
  if (t.includes("cyber")) return "cyber";
  if (t.includes("economic") || t.includes("political") || t.includes("policy") || t.includes("legislation")) {
    return "political";
  }
  return "generic";
}
