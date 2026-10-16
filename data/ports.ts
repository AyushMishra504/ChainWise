export type Port = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
  /** PortWatch `vessel_count_total` — unique vessels seen; drives dot sizing. */
  vesselCount: number;
};

/*
 * Real ports from the IMF PortWatch ports database (ISO3 + coordinates +
 * vessel_count_total). Indian ports listed first; foreign ports are the ends
 * of the modelled trade lanes. `id` is our internal slug (see the PortWatch id
 * mapping in lib/portwatch-map.ts).
 */
export const ports: Port[] = [
  // ---- India ----
  { id: "jnpt", name: "JNPT (Nhava Sheva)", lat: 18.91732276, lng: 72.93965039, country: "IN", vesselCount: 6559 },
  { id: "mundra", name: "Mundra", lat: 22.76296998, lng: 69.6220188, country: "IN", vesselCount: 2815 },
  { id: "kandla", name: "Kandla", lat: 23.0091192, lng: 70.21565487, country: "IN", vesselCount: 1967 },
  { id: "visakhapatnam", name: "Visakhapatnam", lat: 17.65545047, lng: 83.23140922, country: "IN", vesselCount: 1850 },
  { id: "chennai", name: "Chennai (Madras)", lat: 13.10046724, lng: 80.29425074, country: "IN", vesselCount: 1511 },
  { id: "haldia", name: "Haldia", lat: 22.0577906, lng: 88.10419444, country: "IN", vesselCount: 1433 },
  { id: "paradip", name: "Paradip", lat: 20.28045307, lng: 86.64892168, country: "IN", vesselCount: 1267 },
  { id: "tuticorin", name: "Tuticorin", lat: 8.765928225, lng: 78.18889725, country: "IN", vesselCount: 1253 },
  { id: "hazira", name: "Hazira", lat: 21.08674184, lng: 72.64625683, country: "IN", vesselCount: 1238 },
  { id: "new-mangalore", name: "New Mangalore", lat: 12.93776393, lng: 74.81887955, country: "IN", vesselCount: 1135 },
  { id: "cochin", name: "Cochin (Kochi)", lat: 9.969351911, lng: 76.25922208, country: "IN", vesselCount: 1037 },
  { id: "krishnapatnam", name: "Krishnapatnam", lat: 14.26065023, lng: 80.11792197, country: "IN", vesselCount: 916 },
  { id: "pipavav", name: "Pipavav", lat: 20.90789389, lng: 71.46568355, country: "IN", vesselCount: 875 },
  { id: "kolkata", name: "Kolkata", lat: 22.53574401, lng: 88.29958111, country: "IN", vesselCount: 642 },
  { id: "mormugao", name: "Mormugao", lat: 15.40731887, lng: 73.80153102, country: "IN", vesselCount: 367 },
  { id: "sikka", name: "Sikka", lat: 22.36483725, lng: 69.80786454, country: "IN", vesselCount: 488 },
  { id: "vizhinjam", name: "Vizhinjam", lat: 8.368561047, lng: 76.99373664, country: "IN", vesselCount: 55 },

  // ---- Foreign route ends ----
  { id: "shanghai", name: "Shanghai", lat: 31.19179536, lng: 121.6441968, country: "CN", vesselCount: 41093 },
  { id: "singapore", name: "Singapore", lat: 1.271989257, lng: 103.7074816, country: "SG", vesselCount: 44369 },
  { id: "jebel-ali", name: "Jebel Ali", lat: 24.99941947, lng: 55.07781687, country: "AE", vesselCount: 7734 },
  { id: "rotterdam", name: "Rotterdam", lat: 51.92228121, lng: 4.215144967, country: "NL", vesselCount: 32584 },
  { id: "new-york", name: "New York / New Jersey", lat: 40.63298387, lng: -74.17942126, country: "US", vesselCount: 3883 },
  { id: "ras-tanura", name: "Ras Tanura", lat: 26.67168923, lng: 50.12291543, country: "SA", vesselCount: 672 },
  { id: "novorossiysk", name: "Novorossiysk", lat: 44.72345598, lng: 37.8087215, country: "RU", vesselCount: 4438 },
];
