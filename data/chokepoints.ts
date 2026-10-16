export type Chokepoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

// Representative coordinates for the world's major maritime chokepoints.
export const chokepoints: Chokepoint[] = [
  { id: "suez-canal", name: "Suez Canal", lat: 30.705, lng: 32.3442 },
  { id: "strait-of-hormuz", name: "Strait of Hormuz", lat: 26.6, lng: 56.5 },
  { id: "strait-of-malacca", name: "Strait of Malacca", lat: 2.833, lng: 101.037 },
  { id: "panama-canal", name: "Panama Canal", lat: 9.12, lng: -79.75 },
  { id: "bab-el-mandeb", name: "Bab-el-Mandeb", lat: 12.5833, lng: 43.3333 },
  { id: "cape-of-good-hope", name: "Cape of Good Hope", lat: -34.36, lng: 18.47 },
  { id: "strait-of-gibraltar", name: "Strait of Gibraltar", lat: 35.96, lng: -5.5 },
  { id: "bosphorus", name: "Bosphorus Strait", lat: 41.12, lng: 29.05 },
  { id: "dardanelles", name: "Dardanelles", lat: 40.2, lng: 26.4 },
  { id: "english-channel", name: "English Channel (Dover Strait)", lat: 51.0, lng: 1.4 },
  { id: "taiwan-strait", name: "Taiwan Strait", lat: 24.5, lng: 119.5 },
  { id: "singapore-strait", name: "Singapore Strait", lat: 1.25, lng: 103.85 },
  { id: "lombok-strait", name: "Lombok Strait", lat: -8.4, lng: 115.75 },
  { id: "sunda-strait", name: "Sunda Strait", lat: -6.0, lng: 105.88 },
  { id: "gulf-of-aden", name: "Gulf of Aden", lat: 12.0, lng: 48.0 },
  { id: "mozambique-channel", name: "Mozambique Channel", lat: -17.0, lng: 41.0 },
];
