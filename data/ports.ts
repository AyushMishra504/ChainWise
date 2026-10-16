export type Port = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
};

// Major container ports relevant to the modeled trade routes.
// `country` drives dot sizing on the map (Indian ports render larger).
export const ports: Port[] = [
  { id: "nhava-sheva", name: "Nhava Sheva (JNPT)", lat: 18.95, lng: 72.95, country: "IN" },
  { id: "mundra", name: "Mundra", lat: 22.74, lng: 69.7, country: "IN" },
  { id: "chennai", name: "Chennai", lat: 13.1, lng: 80.3, country: "IN" },
  { id: "kandla", name: "Kandla", lat: 23.03, lng: 70.22, country: "IN" },
  { id: "cochin", name: "Cochin", lat: 9.96, lng: 76.26, country: "IN" },
  { id: "tuticorin", name: "Tuticorin", lat: 8.76, lng: 78.13, country: "IN" },
  { id: "kolkata", name: "Kolkata", lat: 22.58, lng: 88.31, country: "IN" },
  { id: "vizag", name: "Vizag", lat: 17.68, lng: 83.28, country: "IN" },
  { id: "shanghai", name: "Shanghai", lat: 31.23, lng: 121.8, country: "CN" },
  { id: "singapore", name: "Singapore", lat: 1.26, lng: 103.84, country: "SG" },
  { id: "jebel-ali", name: "Jebel Ali", lat: 25.01, lng: 55.06, country: "AE" },
  { id: "rotterdam", name: "Rotterdam", lat: 51.95, lng: 4.14, country: "NL" },
];
