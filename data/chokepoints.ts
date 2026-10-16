export type Chokepoint = {
  id: string;
  name: string;
  /** Country (or countries) the strait sits within / borders. */
  country: string;
  lat: number;
  lng: number;
};

// Representative coordinates for the world's major maritime chokepoints.
export const chokepoints: Chokepoint[] = [
  { id: "suez-canal", name: "Suez Canal", country: "Egypt", lat: 30.705, lng: 32.3442 },
  { id: "strait-of-hormuz", name: "Strait of Hormuz", country: "Iran · Oman", lat: 26.6, lng: 56.5 },
  { id: "strait-of-malacca", name: "Strait of Malacca", country: "Malaysia · Indonesia", lat: 2.833, lng: 101.037 },
  { id: "panama-canal", name: "Panama Canal", country: "Panama", lat: 9.12, lng: -79.75 },
  { id: "bab-el-mandeb", name: "Bab-el-Mandeb", country: "Yemen · Djibouti · Eritrea", lat: 12.5833, lng: 43.3333 },
  { id: "cape-of-good-hope", name: "Cape of Good Hope", country: "South Africa", lat: -34.36, lng: 18.47 },
  { id: "strait-of-gibraltar", name: "Strait of Gibraltar", country: "Spain · Morocco · Gibraltar", lat: 35.96, lng: -5.5 },
  { id: "bosphorus", name: "Bosphorus Strait", country: "Turkey", lat: 41.12, lng: 29.05 },
  { id: "dardanelles", name: "Dardanelles", country: "Turkey", lat: 40.2, lng: 26.4 },
  { id: "english-channel", name: "English Channel (Dover Strait)", country: "United Kingdom · France", lat: 51.0, lng: 1.4 },
  { id: "taiwan-strait", name: "Taiwan Strait", country: "Taiwan · China", lat: 24.5, lng: 119.5 },
  { id: "singapore-strait", name: "Singapore Strait", country: "Singapore · Indonesia · Malaysia", lat: 1.25, lng: 103.85 },
  { id: "lombok-strait", name: "Lombok Strait", country: "Indonesia", lat: -8.4, lng: 115.75 },
  { id: "sunda-strait", name: "Sunda Strait", country: "Indonesia", lat: -6.0, lng: 105.88 },
  { id: "gulf-of-aden", name: "Gulf of Aden", country: "Yemen · Somalia · Djibouti", lat: 12.0, lng: 48.0 },
  { id: "mozambique-channel", name: "Mozambique Channel", country: "Mozambique · Madagascar", lat: -17.0, lng: 41.0 },
];
