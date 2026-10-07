'use client';

// SPEC §5.2 step 2. The map draws only our own geometry (island outline and protected areas
// from /api/v1/meta), so it makes no third-party requests and works without a tile server
// (phase-2 decision 3). GPS and typed coordinates work even where WebGL does not.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Map as MlMap, Marker as MlMarker, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { isWithinAruba, type LocationSource, type MultiPolygonCoords } from '@rocan/core';

export interface PickedLocation {
  lat: number;
  lon: number;
  accuracy: number | null;
  source: LocationSource;
}

interface Props {
  land: MultiPolygonCoords;
  areas: { code: string; geometry: MultiPolygonCoords }[];
  bounds: [[number, number], [number, number]];
  provisional: boolean;
  value: PickedLocation | null;
  onChange: (loc: PickedLocation) => void;
}

function styleFor(land: MultiPolygonCoords, areas: Props['areas']): StyleSpecification {
  return {
    version: 8,
    sources: {
      land: {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiPolygon', coordinates: land },
        },
      },
      areas: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: areas.map((a) => ({
            type: 'Feature',
            properties: { code: a.code },
            geometry: { type: 'MultiPolygon', coordinates: a.geometry },
          })),
        },
      },
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': '#cfe8f3' } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f1ead8' } },
      {
        id: 'land-edge',
        type: 'line',
        source: 'land',
        paint: { 'line-color': '#8a7f62', 'line-width': 1.5 },
      },
      {
        id: 'areas',
        type: 'fill',
        source: 'areas',
        paint: { 'fill-color': '#2e8b57', 'fill-opacity': 0.25 },
      },
      {
        id: 'areas-edge',
        type: 'line',
        source: 'areas',
        paint: { 'line-color': '#0b5d3b', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      },
    ],
  };
}

export function LocationPicker({ land, areas, bounds, provisional, value, onChange }: Props) {
  const t = useTranslations('wizard.location');
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const marker = useRef<MlMarker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [mapFailed, setMapFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ lat: '', lon: '' });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        maplibre.setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${maplibre.getVersion()}`);
        if (cancelled || !container.current) return;
        const [[w, s], [e, n]] = bounds;
        const pad = 0.06;
        const m = new maplibre.Map({
          container: container.current,
          style: styleFor(land, areas),
          bounds: [w, s, e, n],
          fitBoundsOptions: { padding: 12 },
          maxBounds: [w - pad, s - pad, e + pad, n + pad],
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
        });
        m.touchZoomRotate.disableRotation();
        m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
        m.on('click', (ev: { lngLat: { lat: number; lng: number } }) =>
          onChangeRef.current({
            lat: ev.lngLat.lat,
            lon: ev.lngLat.lng,
            accuracy: null,
            source: 'map_pin',
          }),
        );
        m.on('error', () => undefined);
        const pin = new maplibre.Marker({ draggable: true, color: '#a4161a' });
        marker.current = pin;
        pin.on('dragend', () => {
          const p = pin.getLngLat();
          onChangeRef.current({ lat: p.lat, lon: p.lng, accuracy: null, source: 'map_pin' });
        });
        map.current = m;
      } catch {
        if (!cancelled) setMapFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The island geometry never changes during a session, so the map is created once.
  }, []);

  // Keep the marker on the chosen point.
  useEffect(() => {
    if (!value || !map.current || !marker.current) return;
    marker.current.setLngLat([value.lon, value.lat]).addTo(map.current);
  }, [value]);

  function useGps() {
    if (!('geolocation' in navigator)) {
      setGpsError(true);
      return;
    }
    setLocating(true);
    setGpsError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const loc: PickedLocation = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          source: 'gps',
        };
        onChange(loc);
        map.current?.flyTo({ center: [loc.lon, loc.lat], zoom: 12 });
      },
      () => {
        setLocating(false);
        setGpsError(true);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }

  function setManualLocation() {
    const lat = Number(manual.lat.replace(',', '.'));
    const lon = Number(manual.lon.replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    onChange({ lat, lon, accuracy: null, source: 'map_pin' });
    map.current?.flyTo({ center: [lon, lat], zoom: 12 });
  }

  const outside = value !== null && !isWithinAruba(value, land);

  return (
    <div className="stack">
      <p>{t('intro')}</p>
      <button
        type="button"
        className="btn btn-block"
        onClick={useGps}
        disabled={locating}
        data-testid="use-gps"
      >
        {locating ? t('locating') : t('useGps')}
      </button>
      {gpsError && (
        <p className="banner banner-info" role="status">
          {t('gpsDenied')}
        </p>
      )}
      {mapFailed ? (
        <p className="banner banner-info">{t('mapUnavailable')}</p>
      ) : (
        <div ref={container} className="map" role="application" aria-label={t('mapLabel')} />
      )}
      {provisional && <p className="muted small">{t('provisional')}</p>}

      <details open={manualOpen || mapFailed} onToggle={(e) => setManualOpen(e.currentTarget.open)}>
        <summary>{t('manual')}</summary>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="field">
            <span>{t('lat')}</span>
            <input
              inputMode="decimal"
              value={manual.lat}
              onChange={(e) => setManual({ ...manual, lat: e.target.value })}
              placeholder="12.5"
              data-testid="manual-lat"
            />
          </label>
          <label className="field">
            <span>{t('lon')}</span>
            <input
              inputMode="decimal"
              value={manual.lon}
              onChange={(e) => setManual({ ...manual, lon: e.target.value })}
              placeholder="-69.97"
              data-testid="manual-lon"
            />
          </label>
        </div>
        <button
          type="button"
          className="btn"
          style={{ marginTop: 8 }}
          onClick={setManualLocation}
          data-testid="manual-set"
        >
          {t('setManual')}
        </button>
      </details>

      <div aria-live="polite" data-testid="location-status">
        {value && (
          <p>
            {t('selected', { lat: value.lat.toFixed(5), lon: value.lon.toFixed(5) })}
            {value.accuracy !== null && <> · {t('accuracy', { meters: value.accuracy })}</>}
          </p>
        )}
        {outside && (
          <p className="banner banner-error" role="alert" data-testid="outside-error">
            {t('outside')}
          </p>
        )}
      </div>
    </div>
  );
}
