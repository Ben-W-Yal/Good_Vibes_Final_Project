/**
 * Region-aware search strings for live conflict / security news (Perigon `q`, GDELT topic).
 * Tuned for recency: war reporting, strikes, military operations — not generic politics.
 */

const GLOBAL_CONFLICT_Q =
  "war OR armed conflict OR airstrike OR missile OR drone strike OR military attack OR invasion OR artillery OR offensive OR shelling OR combat OR raid OR troops OR battlefield OR ceasefire OR frontline OR clash OR strike";

/**
 * GDELT DOC disallows multiple parenthesized OR groups in a single query
 * (error: "Parentheses may only be used around OR'd statements"). We therefore
 * flatten geo + conflict terms into ONE OR group.
 */
const GDELT_CONFLICT_TERMS = [
  "missile",
  "airstrike",
  "drone",
  "artillery",
  "invasion",
  "offensive",
  "shelling",
  "clash",
  "combat",
  "raid",
  "troops",
  "war",
  "military",
  "strike",
  "attack",
];

export function perigonConflictSearchQuery(region?: string): string {
  const r = (region ?? "").trim().toLowerCase();
  if (r.includes("ukraine")) {
    return "ukraine OR russia OR donbas OR crimea OR kharkiv OR zaporizhzhia OR odesa OR missile OR drone OR frontline OR kherson";
  }
  if (r.includes("middle east")) {
    return "gaza OR israel OR hamas OR iran OR syria OR hezbollah OR yemen OR lebanon OR iraq OR palestine OR strike OR military OR missile";
  }
  if (r.includes("asia")) {
    return "taiwan OR south china sea OR north korea OR kashmir OR border OR military OR missile OR exercises OR clash";
  }
  if (r.includes("africa")) {
    return "sudan OR congo OR ethiopia OR somalia OR sahel OR militia OR attack OR conflict OR military";
  }
  if (r.includes("americas")) {
    return "border OR military OR cartel OR conflict OR attack OR strike OR defense";
  }
  if (r.includes("europe")) {
    return "nato OR ukraine OR russia OR missile OR defense OR military OR border OR conflict OR war";
  }
  return GLOBAL_CONFLICT_Q;
}

/**
 * GDELT DOC boolean query — single OR'd bag of geo + conflict terms (DOC only allows one paren group).
 * If a region is provided, pair ONE region term with the conflict terms via implicit AND:
 *   ukraine (missile OR airstrike OR drone OR …)
 * Global (no region) reduces to just the conflict terms.
 */
export function gdeltConflictTopicQuery(region?: string): string {
  const r = (region ?? "").trim().toLowerCase();
  const bag = `(${GDELT_CONFLICT_TERMS.join(" OR ")})`;
  let anchor = "";
  if (r.includes("ukraine")) anchor = "ukraine";
  else if (r.includes("middle east")) anchor = "israel";
  else if (r.includes("asia")) anchor = "china";
  else if (r.includes("africa")) anchor = "sudan";
  else if (r.includes("americas")) anchor = "mexico";
  else if (r.includes("europe")) anchor = "ukraine";
  return anchor ? `${anchor} ${bag}` : bag;
}

/** Softer global topic when conflict focus is off (still newsy, not purely random). */
export function gdeltGeneralTopicQuery(region?: string): string {
  const r = (region ?? "").trim().toLowerCase();
  if (r.includes("ukraine")) return "(ukraine OR kyiv OR crimea OR donetsk OR kharkiv)";
  if (r.includes("middle east")) return "(israel OR gaza OR iran OR syria OR lebanon OR yemen OR iraq)";
  if (r.includes("asia")) return "(china OR taiwan OR japan OR india OR korea OR pakistan)";
  if (r.includes("africa")) return "(sudan OR congo OR nigeria OR ethiopia OR somalia)";
  if (r.includes("americas")) return "(united states OR canada OR mexico OR brazil)";
  if (r.includes("europe")) return "(ukraine OR france OR germany OR poland OR russia OR nato)";
  return "(politics OR diplomacy OR economy OR sanctions OR election OR summit)";
}
