export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "conflict" | "domestic" | "local" | "social";
export type EventType =
  | "Airstrike" | "Missile Strike" | "Drone Strike" | "Rocket Attack"
  | "Explosion" | "Bombing" | "Ground Clashes" | "Ambush" | "Attack" | "Shooting"
  | "Maritime Incident" | "Missile Test" | "Military Exercise"
  | "Military Deployment" | "Military Operation" | "Border Skirmish"
  | "Protest" | "Earthquake" | "Cyber" | "Political" | "Economic"
  | "Legislation" | "Policy" | "Deployment" | "Training";

export interface RelatedArticle {
  title: string;
  url: string;
  domain?: string;
  date?: string;
}

export interface GeoEvent {
  id: string;
  title: string;
  description: string;
  background: string;
  lat: number;
  lng: number;
  severity: Severity;
  category: Category;
  type: EventType;
  region: string;
  country: string;
  source: string;
  sourceUrl: string;
  mediaUrl?: string;
  /** Optional preview image (e.g. GDELT article socialimage) used in the Daily Brief slides. */
  thumbnail?: string;
  timestamp: string; // relative display "2h ago"
  updatedAt: string; // ISO
  /** For cluster-sourced events (GDELT GEO, etc.) we attach the underlying article list. */
  relatedArticles?: RelatedArticle[];
  /** Human-readable place (e.g. "Kyiv, Ukraine") when the source gave a precise geotag. */
  placeName?: string;
  /**
   * False for articles whose lat/lng is only the publisher country's centroid
   * (Perigon or GDELT DOC fallback). They still belong in the news feed but
   * should NOT be plotted on the globe, because a Russo-Ukraine article
   * published by a Jordanian outlet would otherwise show up over Jordan.
   * Default true when omitted.
   */
  mappable?: boolean;
  social: {
    positive: number;
    negative: number;
    neutral: number;
    trending: boolean;
    platforms: { name: string; posts: string[] }[];
  };
}

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
const rel = (h: number) =>
  h < 1 ? `${Math.round(h * 60)}m ago` : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;

export const EVENTS: GeoEvent[] = [
  // ── Ukraine / Russia ──────────────────────────────────────────────────────
  {
    id: "ua-1",
    title: "Explosions reported in Dnipro city",
    description: "Explosions were reported in the Dnipro city area. Air defense systems were activated. Local sources report at least two detonations in the Shevchenkivskyi district.",
    background: "Dnipro (formerly Dnipropetrovsk) is a major industrial and logistics hub in central Ukraine, frequently targeted by Russian long-range strikes since 2022.",
    lat: 48.46, lng: 34.99, severity: "critical", category: "conflict", type: "Explosion",
    region: "Eastern Europe", country: "Ukraine",
    source: "Ukraine Now", sourceUrl: "https://t.me/ukraina_now",
    mediaUrl: "https://t.me/ukraina_now",
    timestamp: rel(0.3), updatedAt: ago(0.3),
    social: { positive: 3, negative: 82, neutral: 15, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["🔴 Explosions in Dnipro — air defense active", "Residents reporting loud blasts in Shevchenkivskyi"] },
        { name: "Telegram", posts: ["Air defense working over Dnipro", "Multiple detonations confirmed by local channels"] },
      ]},
  },
  {
    id: "ua-2",
    title: "Cruise missiles entered Ukrainian airspace",
    description: "Cruise missiles entered Ukrainian airspace from the Black Sea direction. Ukrainian Air Force issued alert across central regions. Air defense reportedly intercepted several warheads.",
    background: "Russia frequently uses Kh-101 and Kalibr cruise missiles launched from bombers and naval vessels in the Black Sea. Ukraine's layered air defense — Patriots, NASAMS, S-300 — intercepts the majority.",
    lat: 49.0, lng: 31.5, severity: "critical", category: "conflict", type: "Missile Strike",
    region: "Eastern Europe", country: "Ukraine",
    source: "Ukrainian Air Force", sourceUrl: "https://t.me/kpszsu",
    timestamp: rel(1), updatedAt: ago(1),
    social: { positive: 4, negative: 85, neutral: 11, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["Ukraine air defense alert issued — missiles inbound", "F-16s scrambled over central Ukraine"] },
        { name: "Telegram", posts: ["Missile threat across multiple oblasts", "Air defense working — stay in shelter"] },
      ]},
  },
  {
    id: "ua-3",
    title: "Air defense activated in Cherkasy region",
    description: "Ukrainian air defense systems were activated in the Cherkasy region following missile threat warnings. Population advised to shelter in place.",
    background: "Cherkasy Oblast has been targeted by Russian strikes aimed at Ukraine's central energy infrastructure, which supplies power to Kyiv and surrounding regions.",
    lat: 49.44, lng: 32.06, severity: "high", category: "conflict", type: "Missile Strike",
    region: "Eastern Europe", country: "Ukraine",
    source: "Cherkasy OVA", sourceUrl: "https://t.me/cherkasyoda",
    timestamp: rel(1), updatedAt: ago(1),
    social: { positive: 5, negative: 78, neutral: 17, trending: false,
      platforms: [
        { name: "X (Twitter)", posts: ["Air defense over Cherkasy", "Oblast admin urges residents to shelter"] },
        { name: "Telegram", posts: ["Explosions reported in Cherkasy — air defense active"] },
      ]},
  },
  {
    id: "ua-4",
    title: "Heavy ground fighting near Chasiv Yar canal line",
    description: "Ukrainian forces repelled two Russian assault attempts on the canal defensive line near Chasiv Yar, Donetsk Oblast. General Staff confirms holding positions.",
    background: "Chasiv Yar is a strategic town on high ground overlooking the Kramatorsk-Sloviansk agglomeration. Its fall would open routes toward these key Ukrainian cities.",
    lat: 48.56, lng: 37.85, severity: "critical", category: "conflict", type: "Ground Clashes",
    region: "Eastern Europe", country: "Ukraine",
    source: "Ukrainian General Staff", sourceUrl: "https://t.me/GeneralStaff_ua",
    timestamp: rel(2), updatedAt: ago(2),
    social: { positive: 12, negative: 65, neutral: 23, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["Ukraine holds Chasiv Yar canal line", "2 Russian assaults repelled — General Staff"] },
        { name: "Telegram", posts: ["Fighting continues near Chasiv Yar", "Drone footage shows destroyed Russian IFVs"] },
      ]},
  },
  {
    id: "ua-5",
    title: "Drone strike on Nizhny Novgorod oil refinery",
    description: "Ukrainian UAVs struck the Kstovo oil refinery in Nizhny Novgorod Oblast, Russia. Large fire reported visible from 30km. Russian air defense intercepted some drones.",
    background: "Ukraine has conducted deep strike campaigns targeting Russian oil refineries and military-industrial facilities to degrade fuel supply for Russian forces.",
    lat: 56.15, lng: 44.19, severity: "high", category: "conflict", type: "Drone Strike",
    region: "Eastern Europe", country: "Russia",
    source: "OSINTtechnical", sourceUrl: "https://twitter.com/OSINTtechnical",
    mediaUrl: "https://t.me/rybar",
    timestamp: rel(3), updatedAt: ago(3),
    social: { positive: 20, negative: 55, neutral: 25, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["Kstovo refinery on fire — drone attack", "Huge smoke plume over Nizhny Novgorod"] },
        { name: "Telegram", posts: ["Ukrainian drones hit Nizhny Novgorod region", "Fire at oil facility visible from highway"] },
      ]},
  },
  {
    id: "ua-6",
    title: "ATACMS strike hits Russian ammo depot in Kursk Oblast",
    description: "Ukrainian ATACMS ballistic missiles struck a Russian ammunition depot near Lgov, Kursk Oblast. Secondary explosions lasted over 40 minutes.",
    background: "Ukraine uses US-supplied ATACMS to strike Russian logistics nodes up to 300km behind the front line, targeting ammunition stores that supply ongoing offensive operations.",
    lat: 51.65, lng: 35.24, severity: "high", category: "conflict", type: "Missile Strike",
    region: "Eastern Europe", country: "Russia",
    source: "Defense Express", sourceUrl: "https://en.defence-ua.com",
    mediaUrl: "https://t.me/flash_news_ua",
    timestamp: rel(5), updatedAt: ago(5),
    social: { positive: 25, negative: 45, neutral: 30, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["ATACMS hits ammo dump in Kursk — huge secondaries", "40 minutes of explosions at Lgov depot"] },
        { name: "Telegram", posts: ["Kursk Oblast ammo depot destroyed", "Shock wave felt 15km away"] },
      ]},
  },
  // ── Middle East ────────────────────────────────────────────────────────────
  {
    id: "gz-1",
    title: "IDF strikes Hamas positions in Rafah following rocket fire",
    description: "Israeli Air Force struck Hamas military infrastructure in Rafah, Gaza after rocket fire toward Israeli communities. Palestinian Health Ministry reports 14 killed.",
    background: "IDF operations in Rafah target remaining Hamas battalion structure in the city after earlier operations in northern and central Gaza. Operations have faced significant international criticism.",
    lat: 31.30, lng: 34.26, severity: "critical", category: "conflict", type: "Airstrike",
    region: "Middle East", country: "Gaza / Israel",
    source: "Al Jazeera", sourceUrl: "https://www.aljazeera.com",
    mediaUrl: "https://youtube.com/watch?v=AlJazeeraLive",
    timestamp: rel(4), updatedAt: ago(4),
    social: { positive: 5, negative: 83, neutral: 12, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["IDF strikes in Rafah", "Gaza health ministry confirms casualties"] },
        { name: "Instagram", posts: ["Smoke over Rafah", "Protest rallies worldwide"] },
        { name: "Telegram", posts: ["New strikes in southern Gaza", "Aid convoy blocked at Rafah crossing"] },
      ]},
  },
  {
    id: "gz-2",
    title: "Hezbollah fires 40 rockets at northern Israel",
    description: "Hezbollah launched approximately 40 Katyusha rockets toward Haifa and the Galilee from southern Lebanon. Iron Dome intercepted most. 3 lightly wounded.",
    background: "Hezbollah has maintained a 'support front' since October 2023, with regular rocket and anti-tank missile exchanges. Escalations have periodically threatened full-scale conflict.",
    lat: 32.82, lng: 34.99, severity: "high", category: "conflict", type: "Rocket Attack",
    region: "Middle East", country: "Israel / Lebanon",
    source: "IDF Spokesperson", sourceUrl: "https://twitter.com/IDF",
    timestamp: rel(6), updatedAt: ago(6),
    social: { positive: 5, negative: 74, neutral: 21, trending: false,
      platforms: [
        { name: "X (Twitter)", posts: ["Rockets fired at Haifa from Lebanon", "Iron Dome intercepts over northern Israel"] },
        { name: "Telegram", posts: ["Hezbollah claims rocket barrage at Haifa", "Sirens across Galilee region"] },
      ]},
  },
  {
    id: "ys-1",
    title: "Houthi missile targets cargo ship in Red Sea",
    description: "Houthi forces fired an anti-ship ballistic missile at a commercial vessel in the Red Sea. USS Gravely (DDG-107) intercepted the missile. No casualties.",
    background: "Since November 2023, Houthis have attacked over 100 commercial vessels in the Red Sea, forcing major shipping lanes to divert around Africa, adding weeks and significant costs.",
    lat: 14.5, lng: 42.85, severity: "high", category: "conflict", type: "Maritime Incident",
    region: "Middle East", country: "Yemen / Red Sea",
    source: "CENTCOM", sourceUrl: "https://twitter.com/CENTCOM",
    timestamp: rel(7), updatedAt: ago(7),
    social: { positive: 8, negative: 70, neutral: 22, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["Houthi ASBM intercepted by USS Gravely", "Red Sea shipping costs hit record high"] },
        { name: "Telegram", posts: ["Ansar Allah claims missile attack on cargo ship", "US Navy confirms interception"] },
      ]},
  },
  // ── Africa ─────────────────────────────────────────────────────────────────
  {
    id: "sd-1",
    title: "SAF airstrikes on RSF positions in Omdurman",
    description: "Sudanese Armed Forces conducted multiple airstrikes on RSF-controlled districts of Omdurman. Street fighting reported in Wad Nubawi area. Civilians fleeing.",
    background: "Sudan's civil war between the SAF and paramilitary Rapid Support Forces has displaced over 10 million people and caused one of the world's worst humanitarian crises.",
    lat: 15.64, lng: 32.48, severity: "critical", category: "conflict", type: "Airstrike",
    region: "Africa", country: "Sudan",
    source: "Sudan War Monitor", sourceUrl: "https://sudanwarmonitor.com",
    timestamp: rel(8), updatedAt: ago(8),
    social: { positive: 3, negative: 84, neutral: 13, trending: false,
      platforms: [
        { name: "X (Twitter)", posts: ["Airstrikes hit Omdurman residential areas", "Civilians trapped as fighting continues"] },
        { name: "Telegram", posts: ["SAF bombs RSF in Omdurman", "No humanitarian access in Khartoum state"] },
      ]},
  },
  {
    id: "drc-1",
    title: "M23 clash with FARDC within 5km of Goma airport",
    description: "M23 rebels clashed with DRC Armed Forces within 5km of Goma international airport. UN observers documented Rwandan artillery support for M23 forces.",
    background: "M23, backed by Rwanda, captured Goma in early 2025. DRC has accused Rwanda of direct military involvement, a claim denied by Kigali. The conflict has triggered a regional diplomatic crisis.",
    lat: -1.67, lng: 29.24, severity: "critical", category: "conflict", type: "Ground Clashes",
    region: "Africa", country: "DR Congo",
    source: "UN MONUSCO", sourceUrl: "https://monusco.unmissions.org",
    timestamp: rel(10), updatedAt: ago(10),
    social: { positive: 3, negative: 80, neutral: 17, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["Fighting near Goma airport", "DRC accuses Rwanda of direct military role"] },
        { name: "Telegram", posts: ["FARDC retreating in North Kivu", "Humanitarian agencies evacuate Goma staff"] },
      ]},
  },
  // ── Asia-Pacific ──────────────────────────────────────────────────────────
  {
    id: "tw-1",
    title: "PLA carrier strike group transits Taiwan Strait",
    description: "PLA Navy Shandong carrier strike group completed transit of the Taiwan Strait. Taiwan scrambled 12 F-16Vs. USS Ronald Reagan CSG monitoring from Philippine Sea.",
    background: "PLA exercises near Taiwan have intensified significantly since Nancy Pelosi's 2022 visit. China views Taiwan as a breakaway province; Taiwan's government rejects this characterization.",
    lat: 24.5, lng: 122.0, severity: "high", category: "conflict", type: "Military Exercise",
    region: "Indo-Pacific", country: "Taiwan / China",
    source: "Taiwan MND", sourceUrl: "https://www.mnd.gov.tw",
    timestamp: rel(12), updatedAt: ago(12),
    social: { positive: 10, negative: 60, neutral: 30, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["PLA carrier group in Taiwan Strait", "Taiwan F-16s scramble to intercept"] },
        { name: "Telegram", posts: ["Shandong CSG transit complete", "US carrier monitoring situation"] },
      ]},
  },
  {
    id: "sc-1",
    title: "China coast guard uses water cannon on Philippine vessel",
    description: "China Coast Guard used water cannons on Philippine resupply vessel BRP Teresa Magbanua near Scarborough Shoal. Manila summons Chinese ambassador.",
    background: "China and Philippines are locked in a long-running dispute over the South China Sea. Scarborough Shoal was seized by China in 2012, effectively blocking Filipino fishermen.",
    lat: 15.12, lng: 117.75, severity: "high", category: "conflict", type: "Maritime Incident",
    region: "Indo-Pacific", country: "Philippines / China",
    source: "Philippine Coast Guard", sourceUrl: "https://www.pcg.gov.ph",
    timestamp: rel(5), updatedAt: ago(5),
    social: { positive: 8, negative: 72, neutral: 20, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["China attacks Philippine ship AGAIN", "Manila summons Chinese ambassador — fourth time this month"] },
        { name: "Instagram", posts: ["Video shows PCG vessel under water cannon"] },
        { name: "Telegram", posts: ["BRP Teresa Magbanua harassed at Scarborough Shoal"] },
      ]},
  },
  {
    id: "nk-1",
    title: "North Korea launches ICBM — Japan issues J-Alert",
    description: "North Korea launched a Hwasong-17 ICBM from Sunan, flew ~1,000km in lofted trajectory. Japan issued a J-Alert warning. UNSC emergency session called.",
    background: "DPRK has dramatically accelerated its ballistic missile program, now possessing solid-fuel ICBMs potentially capable of striking the continental United States.",
    lat: 39.24, lng: 125.67, severity: "critical", category: "conflict", type: "Missile Test",
    region: "Northeast Asia", country: "North Korea",
    source: "Japan JCS / USFK", sourceUrl: "https://www.usfk.mil",
    timestamp: rel(20), updatedAt: ago(20),
    social: { positive: 4, negative: 82, neutral: 14, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["DPRK fires ICBM — J-Alert issued in Japan", "UNSC convening emergency session"] },
        { name: "Telegram", posts: ["Hwasong-17 confirmed by South Korean JCS", "Kim Jong Un celebrates successful test"] },
      ]},
  },
  // ── Americas ──────────────────────────────────────────────────────────────
  {
    id: "ve-1",
    title: "Venezuela mobilizes troops to Essequibo border",
    description: "Venezuelan military mobilized additional armored units to the Essequibo border. PDVSA announced oil exploration plans in disputed territory. Guyana raises alarm.",
    background: "Venezuela claims the Essequibo region — 70% of Guyana's territory. A massive offshore oil discovery has intensified the dispute, with Venezuela holding a referendum in 2023 to annex the region.",
    lat: 6.8, lng: -60.5, severity: "high", category: "conflict", type: "Military Deployment",
    region: "South America", country: "Venezuela / Guyana",
    source: "Reuters", sourceUrl: "https://www.reuters.com",
    timestamp: rel(24), updatedAt: ago(24),
    social: { positive: 10, negative: 60, neutral: 30, trending: false,
      platforms: [
        { name: "X (Twitter)", posts: ["Venezuela armored units at Guyana border", "ExxonMobil operations continue in disputed zone"] },
        { name: "Telegram", posts: ["Venezuelan troops mobilize to Essequibo", "Guyana requests OAS emergency meeting"] },
      ]},
  },
  // ── Europe ────────────────────────────────────────────────────────────────
  {
    id: "ee-1",
    title: "Pipeline explosion near Estonia-Russia border",
    description: "Suspected sabotage at gas pipeline junction near Narva, Estonia. Estonian KAPO security police investigating hybrid warfare connection. NATO allies alerted.",
    background: "Baltic states have faced repeated infrastructure sabotage suspected to be Russian hybrid warfare. Estonia, Latvia, and Lithuania recently completed disconnect from the Russian BRELL power grid.",
    lat: 59.38, lng: 28.19, severity: "high", category: "conflict", type: "Explosion",
    region: "Europe", country: "Estonia",
    source: "ERR News", sourceUrl: "https://news.err.ee",
    timestamp: rel(14), updatedAt: ago(14),
    social: { positive: 5, negative: 72, neutral: 23, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["Pipeline explosion near Russian border in Estonia", "NATO allies on alert after Narva sabotage"] },
        { name: "Telegram", posts: ["Estonian KAPO investigates pipeline blast", "Suspected Russian hybrid attack on Baltic infrastructure"] },
      ]},
  },
  // ── Domestic US ──────────────────────────────────────────────────────────
  {
    id: "us-1",
    title: "China imposes 84% retaliatory tariffs on US goods",
    description: "Beijing announced 84% retaliatory tariffs on US agricultural exports following new US semiconductor controls. Markets fell 2.4%. Treasury convenes emergency meeting.",
    background: "US-China economic decoupling has accelerated through successive rounds of export controls, tariffs, and investment restrictions centered on advanced semiconductor technology.",
    lat: 38.89, lng: -77.04, severity: "critical", category: "domestic", type: "Economic",
    region: "North America", country: "United States / China",
    source: "FT / Reuters", sourceUrl: "https://www.ft.com",
    timestamp: rel(1), updatedAt: ago(1),
    social: { positive: 10, negative: 76, neutral: 14, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["China 84% tariffs — S&P drops 2.4%", "Trade war escalates: farmers face massive losses"] },
        { name: "Reddit", posts: ["r/Economics: Is this the start of full decoupling?", "Markets panic on China tariff news"] },
        { name: "Telegram", posts: ["US-China trade war enters new phase", "Soy and corn exports to China effectively banned"] },
      ]},
  },
  {
    id: "us-2",
    title: "FBI confirms Salt Typhoon breached 12 US telecom firms",
    description: "FBI Director confirmed PRC-linked Salt Typhoon hacked 12 US telecom firms, accessing metadata on millions. Senate Intelligence Committee convenes closed briefing.",
    background: "Salt Typhoon is a sophisticated Chinese state APT group. The telecom breaches focused on intelligence collection targeting government officials and defense contractors.",
    lat: 38.89, lng: -77.09, severity: "high", category: "domestic", type: "Cyber",
    region: "North America", country: "United States",
    source: "FBI / CISA", sourceUrl: "https://www.fbi.gov",
    timestamp: rel(30), updatedAt: ago(30),
    social: { positive: 4, negative: 80, neutral: 16, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["China hacked 12 US telecoms — FBI confirms", "Salt Typhoon espionage campaign exposed"] },
        { name: "Reddit", posts: ["r/netsec: Salt Typhoon TTPs breakdown", "r/politics: Senate demands answers on telecom breach"] },
        { name: "Telegram", posts: ["FBI confirms massive Chinese telecom hack", "CISA issues emergency directive to carriers"] },
      ]},
  },
  {
    id: "us-3",
    title: "Senate passes $45B Ukraine supplemental aid",
    description: "US Senate approved $45B supplemental package for Ukraine: $28B military, $12B economic, $5B humanitarian. 68-32 bipartisan vote.",
    background: "Congress has periodically passed large supplemental Ukraine aid packages since the 2022 invasion, with each vote facing increasing domestic political friction.",
    lat: 38.89, lng: -77.01, severity: "medium", category: "domestic", type: "Legislation",
    region: "North America", country: "United States",
    source: "AP / Senate.gov", sourceUrl: "https://www.senate.gov",
    timestamp: rel(8), updatedAt: ago(8),
    social: { positive: 45, negative: 38, neutral: 17, trending: true,
      platforms: [
        { name: "X (Twitter)", posts: ["Senate 68-32 passes Ukraine aid", "Zelensky thanks US Congress"] },
        { name: "Reddit", posts: ["r/UkraineWarVideoReport: $28B military aid breakdown", "r/worldnews: Aid package analysis"] },
        { name: "Telegram", posts: ["US Congress approves Ukraine aid", "Aid package includes long-range strike systems"] },
      ]},
  },
  // ── Local (Hampton Roads) ─────────────────────────────────────────────────
  {
    id: "hr-1",
    title: "USS Gerald R. Ford CSG departs Norfolk for deployment",
    description: "USS Gerald R. Ford (CVN-78) carrier strike group departed Naval Station Norfolk for Mediterranean and Indo-Pacific deployment. Accompanied by USS Normandy and USS Mitscher.",
    background: "Naval Station Norfolk is the world's largest naval base. The Ford-class carriers are the most advanced in US Navy history. The group previously operated in support of Middle East operations.",
    lat: 36.95, lng: -76.33, severity: "low", category: "local", type: "Deployment",
    region: "Hampton Roads", country: "United States",
    source: "US Navy / Pilot Online", sourceUrl: "https://www.pilotonline.com",
    timestamp: rel(4), updatedAt: ago(4),
    social: { positive: 72, negative: 4, neutral: 24, trending: false,
      platforms: [
        { name: "X (Twitter)", posts: ["USS Gerald R. Ford departs Norfolk", "Carrier strike group heads to Med"] },
        { name: "Instagram", posts: ["Families see off sailors at Pier 12", "Impressive sight as Ford leaves port"] },
        { name: "TikTok", posts: ["Watch the USS Ford leave Norfolk 🇺🇸", "Sailors saying goodbye to families"] },
      ]},
  },
  {
    id: "hr-2",
    title: "DEVGRU multi-day training exercise at Dam Neck Annex",
    description: "Naval Special Warfare Development Group (DEVGRU / SEAL Team Six) conducting multi-day exercise at Dam Neck Annex. Beach access restricted in adjacent areas.",
    background: "Dam Neck Annex houses DEVGRU, the US Navy's Tier 1 special mission unit responsible for national-level counterterrorism operations globally.",
    lat: 36.84, lng: -75.97, severity: "low", category: "local", type: "Training",
    region: "Hampton Roads", country: "United States",
    source: "WAVY News", sourceUrl: "https://www.wavy.com",
    timestamp: rel(12), updatedAt: ago(12),
    social: { positive: 65, negative: 5, neutral: 30, trending: false,
      platforms: [
        { name: "X (Twitter)", posts: ["Military training restricts Virginia Beach access", "Helicopters flying overnight near Dam Neck"] },
        { name: "Reddit", posts: ["r/virginiabeach: Anyone see the helicopters last night?", "Training at Dam Neck — beach closed"] },
      ]},
  },
];

// Map event type to icon class
export function getIconClass(type: EventType): string {
  const map: Partial<Record<EventType, string>> = {
    "Airstrike": "icon-strike",
    "Missile Strike": "icon-missile",
    "Drone Strike": "icon-strike",
    "Rocket Attack": "icon-missile",
    "Explosion": "icon-explosion",
    "Bombing": "icon-explosion",
    "Ground Clashes": "icon-clashes",
    "Ambush": "icon-clashes",
    "Attack": "icon-clashes",
    "Shooting": "icon-clashes",
    "Maritime Incident": "icon-maritime",
    "Missile Test": "icon-missile",
    "Military Exercise": "icon-clashes",
    "Military Deployment": "icon-political",
    "Military Operation": "icon-clashes",
    "Border Skirmish": "icon-clashes",
    "Protest": "icon-protest",
    "Earthquake": "icon-explosion",
    "Cyber": "icon-cyber",
    "Political": "icon-political",
    "Economic": "icon-cyber",
    "Legislation": "icon-political",
    "Policy": "icon-political",
    "Deployment": "icon-political",
    "Training": "icon-political",
  };
  return map[type] ?? "icon-other";
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#f85149",
  high:     "#f0883e",
  medium:   "#d29922",
  low:      "#3fb950",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  high:     "HIGH",
  medium:   "MEDIUM",
  low:      "LOW",
};

const GLOBAL_LOCATIONS: Array<{ lat: number; lng: number; country: string; region: string }> = [
  { lat: 40.71, lng: -74.0, country: "United States", region: "North America" },
  { lat: -23.55, lng: -46.63, country: "Brazil", region: "South America" },
  { lat: 51.5, lng: -0.12, country: "United Kingdom", region: "Europe" },
  { lat: 48.85, lng: 2.35, country: "France", region: "Europe" },
  { lat: 30.04, lng: 31.24, country: "Egypt", region: "Africa" },
  { lat: 6.52, lng: 3.37, country: "Nigeria", region: "Africa" },
  { lat: 19.43, lng: -99.13, country: "Mexico", region: "North America" },
  { lat: 35.68, lng: 139.69, country: "Japan", region: "Asia" },
  { lat: 1.35, lng: 103.82, country: "Singapore", region: "Asia" },
  { lat: 28.61, lng: 77.21, country: "India", region: "Asia" },
  { lat: -33.87, lng: 151.21, country: "Australia", region: "Oceania" },
  { lat: 25.2, lng: 55.27, country: "UAE", region: "Middle East" },
  { lat: -1.29, lng: 36.82, country: "Kenya", region: "Africa" },
  { lat: 55.75, lng: 37.61, country: "Russia", region: "Europe" },
  { lat: 39.9, lng: 116.4, country: "China", region: "Asia" },
  { lat: 41.0, lng: 29.0, country: "Turkey", region: "Middle East" },
];

const LIVE_TYPES: EventType[] = [
  "Drone Strike", "Bombing", "Shooting", "Explosion", "Ground Clashes",
  "Missile Strike", "Rocket Attack", "Cyber", "Political", "Protest",
  "Maritime Incident", "Military Deployment",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export function createSyntheticEvent(id: string, base?: GeoEvent): GeoEvent {
  const source = base ?? pick(EVENTS);
  const loc = pick(GLOBAL_LOCATIONS);
  const minsAgo = Math.floor(rand(1, 90));
  const type = pick(LIVE_TYPES);
  const severity: Severity =
    type === "Missile Strike" || type === "Bombing" ? "critical" :
    type === "Drone Strike" || type === "Shooting" || type === "Ground Clashes" ? "high" :
    type === "Cyber" || type === "Maritime Incident" ? "medium" : "low";
  const category: Category = type === "Political" || type === "Protest" ? "social" : "conflict";
  const updatedAt = new Date(Date.now() - minsAgo * 60_000).toISOString();
  const timestamp = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`;

  return {
    ...source,
    id,
    title: `${type} update near ${loc.country}`,
    description: `Breaking reports indicate ${type.toLowerCase()} activity near major population centers in ${loc.country}.`,
    background: `Generated live intelligence update for ${loc.region}.`,
    lat: loc.lat + rand(-1.4, 1.4),
    lng: loc.lng + rand(-1.8, 1.8),
    type,
    severity,
    category,
    region: loc.region,
    country: loc.country,
    timestamp,
    updatedAt,
  };
}
