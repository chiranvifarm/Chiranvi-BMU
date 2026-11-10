"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import styles from "./map-pin-picker.module.css";

/*
  A small map to put an address's pin exactly where the gate is (Leaflet with OpenStreetMap's free map tiles).
  The pin stays in the middle; the customer moves the map under it, as in food delivery apps. Zooming keeps the
  middle where it is, so it never moves the pin.
  - Opens on the pin when there is one, else on Bengaluru (nothing is placed until the map is moved or a place is
    searched, so opening it never gives an address a made-up pin).
  - Search: OpenStreetMap's free place search, once per tap (its limit is one a second). An empty box searches
    what was typed in the address (searchFallback). The map goes there and that spot becomes the pin.
  - A pin set from outside (the phone's GPS) moves the map there.
  Used by the address form (My Addresses, the cart, Profile). Leaflet is loaded only in the browser, when the map
  is shown, so it adds nothing to pages without it.
*/

type Pin = { latitude: number; longitude: number };

// Opening view when the address has no pin yet
const BENGALURU_CENTRE: Pin = { latitude: 12.9716, longitude: 77.5946 };
const ZOOM_WITHOUT_PIN = 11;
const ZOOM_ON_PIN = 17;
// India, roughly: the map can't be moved out of it (the database refuses pins outside it)
const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [6, 68],
  [37.5, 97.5],
];
const OPENSTREETMAP_TILES_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OPENSTREETMAP_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const OPENSTREETMAP_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

type SearchState = { step: "idle" } | { step: "searching" } | { step: "not-found" } | { step: "failed" };

// The first place in India OpenStreetMap finds for the words, or null (nothing found), or "failed" (offline, slow)
async function searchPlace(words: string): Promise<Pin | null | "failed"> {
  const query = new URLSearchParams({ q: words, format: "jsonv2", limit: "1", countrycodes: "in", "accept-language": "en" });
  const stopWaiting = new AbortController();
  const timer = window.setTimeout(() => stopWaiting.abort(), 8000);
  try {
    const response = await fetch(`${OPENSTREETMAP_SEARCH_URL}?${query}`, { signal: stopWaiting.signal });
    if (!response.ok) return "failed";
    const places = (await response.json()) as { lat: string; lon: string }[];
    const place = places[0];
    return place ? { latitude: Number(place.lat), longitude: Number(place.lon) } : null;
  } catch {
    return "failed";
  } finally {
    window.clearTimeout(timer);
  }
}

export default function MapPinPicker({
  pin,
  onPinChange,
  searchFallback,
}: {
  pin: Pin | null;
  onPinChange: (pin: Pin) => void;
  // What to search when the box is empty ("Kadugodi, Bengaluru 560067": the address typed so far)
  searchFallback: string;
}) {
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  // The pin the map is showing, so a pin coming back from the form after a move doesn't move the map again
  const shownPinRef = useRef<Pin | null>(pin);
  const startPinRef = useRef<Pin | null>(pin);
  // Latest onPinChange for the map's listeners (set up once)
  const onPinChangeRef = useRef(onPinChange);
  useEffect(() => {
    onPinChangeRef.current = onPinChange;
  }, [onPinChange]);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapProblem, setMapProblem] = useState(false);
  const [searchWords, setSearchWords] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ step: "idle" });

  // The map, made once in the browser
  useEffect(() => {
    let isStillWanted = true;
    async function makeMap() {
      try {
        const leafletModule = await import("leaflet");
        const leaflet = (leafletModule as unknown as { default?: typeof leafletModule }).default ?? leafletModule;
        if (!isStillWanted || !mapBoxRef.current) return;
        const start = startPinRef.current;
        const map = leaflet.map(mapBoxRef.current, {
          center: start ? [start.latitude, start.longitude] : [BENGALURU_CENTRE.latitude, BENGALURU_CENTRE.longitude],
          zoom: start ? ZOOM_ON_PIN : ZOOM_WITHOUT_PIN,
          minZoom: 5,
          maxBounds: INDIA_BOUNDS,
          maxBoundsViscosity: 1,
          // Zooming keeps the middle (the pin) where it is
          scrollWheelZoom: "center",
          doubleClickZoom: "center",
          touchZoom: "center",
        });
        leaflet.tileLayer(OPENSTREETMAP_TILES_URL, { maxZoom: 19, attribution: OPENSTREETMAP_CREDIT }).addTo(map);
        // Only a move the customer made sets the pin (not opening the map or a move from the GPS or a search)
        let isMovedByCustomer = false;
        map.on("dragstart", () => {
          isMovedByCustomer = true;
        });
        map.on("moveend", () => {
          if (!isMovedByCustomer) return;
          isMovedByCustomer = false;
          const middle = map.getCenter();
          const movedPin = { latitude: Number(middle.lat.toFixed(6)), longitude: Number(middle.lng.toFixed(6)) };
          shownPinRef.current = movedPin;
          onPinChangeRef.current(movedPin);
        });
        mapRef.current = map;
        setIsMapReady(true);
        // The pop-up may still be opening: measure the box again once it has its size
        window.setTimeout(() => map.invalidateSize(), 250);
      } catch {
        if (isStillWanted) setMapProblem(true);
      }
    }
    void makeMap();
    return () => {
      isStillWanted = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // A pin set from outside (the phone's GPS): the map goes there
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pin) return;
    const shown = shownPinRef.current;
    if (shown && shown.latitude === pin.latitude && shown.longitude === pin.longitude) return;
    shownPinRef.current = pin;
    map.setView([pin.latitude, pin.longitude], Math.max(map.getZoom(), ZOOM_ON_PIN));
  }, [pin, isMapReady]);

  async function search() {
    const words = searchWords.trim() || searchFallback.trim();
    if (!words || searchState.step === "searching") return;
    setSearchState({ step: "searching" });
    const found = await searchPlace(words);
    if (found === "failed") {
      setSearchState({ step: "failed" });
      return;
    }
    if (!found) {
      setSearchState({ step: "not-found" });
      return;
    }
    setSearchState({ step: "idle" });
    shownPinRef.current = found;
    mapRef.current?.setView([found.latitude, found.longitude], ZOOM_ON_PIN);
    onPinChangeRef.current(found);
  }

  // Enter in the search box searches (and doesn't send the address form)
  function searchOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void search();
  }

  return (
    <div className={styles["map-pin-picker"]}>
      <div className={styles["map-pin-picker-search-row"]}>
        <input
          type="search"
          value={searchWords}
          placeholder="Search area, street or landmark"
          aria-label="Search a place on the map"
          className={styles["map-pin-picker-search-input"]}
          onChange={(event) => {
            setSearchWords(event.target.value);
            if (searchState.step !== "searching") setSearchState({ step: "idle" });
          }}
          onKeyDown={searchOnEnter}
        />
        <button
          type="button"
          className={styles["map-pin-picker-search-button"]}
          disabled={searchState.step === "searching" || (!searchWords.trim() && !searchFallback.trim())}
          onClick={() => void search()}
        >
          {searchState.step === "searching" ? "Searching…" : "Search"}
        </button>
      </div>
      {(searchState.step === "not-found" || searchState.step === "failed") && (
        <span role="status" className={styles["map-pin-picker-search-problem"]}>
          {searchState.step === "not-found"
            ? "Couldn't find that place. Try a nearby landmark or the area name, or move the map."
            : "Couldn't search right now. Check the internet connection, or move the map."}
        </span>
      )}

      <div className={styles["map-pin-picker-map-frame"]}>
        <div ref={mapBoxRef} className={styles["map-pin-picker-map"]} aria-label="Map: move it so the pin is on the gate" />
        {/* The pin, fixed in the middle: its tip is the spot */}
        <svg className={styles["map-pin-picker-pin"]} viewBox="0 0 24 32" aria-hidden="true">
          <path d="M12 31s-10-9.2-10-17.5a10 10 0 0 1 20 0C22 21.8 12 31 12 31Z" />
          <circle cx="12" cy="13" r="3.6" />
        </svg>
        {!isMapReady && (
          <div className={styles["map-pin-picker-map-loading"]}>{mapProblem ? "The map couldn't load. You can still use your current location." : "Loading the map…"}</div>
        )}
      </div>
    </div>
  );
}
