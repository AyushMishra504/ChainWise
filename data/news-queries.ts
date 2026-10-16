/*
 * Per-chokepoint news aliases. An article matches a chokepoint when any alias
 * appears (case-insensitively) in its title or short feed description.
 *
 * One entry per PortWatch-matched chokepoint plus Dardanelles, Gulf of Aden,
 * Mozambique Channel and Singapore Strait (which have no transit data and so
 * rely on news alone). Names are human-friendly; aliases include the common
 * short forms and demonyms used by trade press.
 */

export type NewsQuery = {
  chokepointId: string;
  /** Human-friendly chokepoint name. */
  name: string;
  /** Case-insensitive substrings matched against title + description. */
  aliases: string[];
};

export const NEWS_QUERIES: NewsQuery[] = [
  { chokepointId: "suez-canal", name: "Suez Canal", aliases: ["Suez Canal", "Suez"] },
  { chokepointId: "strait-of-hormuz", name: "Strait of Hormuz", aliases: ["Strait of Hormuz", "Hormuz"] },
  {
    chokepointId: "bab-el-mandeb",
    name: "Bab-el-Mandeb / Red Sea",
    aliases: ["Red Sea", "Bab el-Mandeb", "Bab-el-Mandeb", "Houthi", "Houthis"],
  },
  { chokepointId: "strait-of-malacca", name: "Strait of Malacca", aliases: ["Strait of Malacca", "Malacca"] },
  { chokepointId: "panama-canal", name: "Panama Canal", aliases: ["Panama Canal", "Panama"] },
  { chokepointId: "cape-of-good-hope", name: "Cape of Good Hope", aliases: ["Cape of Good Hope", "Good Hope"] },
  { chokepointId: "strait-of-gibraltar", name: "Strait of Gibraltar", aliases: ["Strait of Gibraltar", "Gibraltar"] },
  { chokepointId: "bosphorus", name: "Bosphorus", aliases: ["Bosphorus", "Bosporus", "Istanbul Strait"] },
  { chokepointId: "dardanelles", name: "Dardanelles", aliases: ["Dardanelles", "Canakkale", "Çanakkale"] },
  { chokepointId: "english-channel", name: "English Channel", aliases: ["English Channel", "Dover Strait", "Dover"] },
  { chokepointId: "taiwan-strait", name: "Taiwan Strait", aliases: ["Taiwan Strait", "Taiwan"] },
  { chokepointId: "lombok-strait", name: "Lombok Strait", aliases: ["Lombok Strait", "Lombok"] },
  { chokepointId: "sunda-strait", name: "Sunda Strait", aliases: ["Sunda Strait", "Sunda"] },
  { chokepointId: "gulf-of-aden", name: "Gulf of Aden", aliases: ["Gulf of Aden", "Aden"] },
  {
    chokepointId: "mozambique-channel",
    name: "Mozambique Channel",
    aliases: ["Mozambique Channel", "Mozambique"],
  },
  { chokepointId: "singapore-strait", name: "Singapore Strait", aliases: ["Singapore Strait", "Singapore"] },
];

export const NEWS_QUERY_BY_CHOKEPOINT: Record<string, NewsQuery> = Object.fromEntries(
  NEWS_QUERIES.map((query) => [query.chokepointId, query]),
);