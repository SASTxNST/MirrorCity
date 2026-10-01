// Starting points offered in onboarding and in the explorer's jump list.
//
// Every entry is somewhere OpenStreetMap is densely mapped. That matters more
// than the place being famous: a campus nobody has traced renders as an empty
// plane, which reads as a broken product rather than a thin dataset. Each
// coordinate here was resolved through Nominatim and checked for building
// coverage before being added.

export type Place = {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  radiusM: number;
  /** Why this place is worth opening first. */
  note: string;
  /** ISO 3166-1 alpha-2, used to bias the news feed to local outlets. */
  country: string;
};

export const PLACES: Place[] = [
  {
    id: "connaught-place",
    name: "Connaught Place",
    region: "New Delhi",
    lat: 28.6318,
    lon: 77.2194,
    radiusM: 700,
    note: "Radial colonial plan, 450+ buildings",
    country: "IN",
  },
  {
    id: "charminar",
    name: "Charminar",
    region: "Hyderabad",
    lat: 17.3616,
    lon: 78.4746,
    radiusM: 400,
    note: "Dense old city around the monument",
    country: "IN",
  },
  {
    id: "fort-mumbai",
    name: "Fort",
    region: "Mumbai",
    lat: 18.9414,
    lon: 72.8354,
    radiusM: 700,
    note: "Heritage core at CSMT",
    country: "IN",
  },
  {
    id: "mg-road-bengaluru",
    name: "M.G. Road",
    region: "Bengaluru",
    lat: 12.9755,
    lon: 77.6068,
    radiusM: 700,
    note: "Central business district",
    country: "IN",
  },
  {
    id: "park-street-kolkata",
    name: "Park Street",
    region: "Kolkata",
    lat: 22.5552,
    lon: 88.3501,
    radiusM: 700,
    note: "High-density central Kolkata",
    country: "IN",
  },
  {
    id: "banaras-ghats",
    name: "Banaras Ghats",
    region: "Varanasi",
    lat: 25.3066,
    lon: 83.0103,
    radiusM: 500,
    note: "Riverfront, flood-exposed",
    country: "IN",
  },
  // Two cities outside India, kept because their transport authorities publish
  // live traffic cameras: Transport for London and Caltrans. Nothing
  // equivalent is published openly for an Indian city, so these are where the
  // camera layer can actually be seen working.
  {
    id: "westminster",
    name: "Westminster",
    region: "London",
    lat: 51.4973,
    lon: -0.1371,
    radiusM: 800,
    note: "890 TfL traffic cameras citywide",
    country: "GB",
  },
  {
    id: "sf-financial",
    name: "Financial District",
    region: "San Francisco",
    lat: 37.7936,
    lon: -122.3989,
    radiusM: 700,
    note: "756 Caltrans cameras in the Bay Area",
    country: "US",
  },
];

export function findPlace(id: string | null | undefined): Place | null {
  return PLACES.find((place) => place.id === id) ?? null;
}
