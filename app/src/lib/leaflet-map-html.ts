import { useMemo } from 'react';

import { Tiers } from '@/constants/theme';
import type { NearbyEvent } from '@/lib/api';
import { TIER_LABELS } from '@/lib/event-format';
import { NYC_BOUNDS, NYC_MIN_ZOOM, NYC_REGION } from '@/lib/nyc';

// The events map is a Leaflet page with OpenStreetMap's standard tiles, so it needs no API key.
// Phones load it in a WebView and web loads it in an iframe. The app and the page talk by messages:
// the app sends `MapCommand`s, and the page answers with `MapEvent`s.
//
// OpenStreetMap's tile servers block requests without a Referer (see their tile usage policy), so the
// WebView gives the page this address. Nothing is loaded from it; it only names the app in tile requests.
// The iframe on web shares the app's own address, which works the same way.
export const MAP_PAGE_URL = 'https://cleanpursuit.app/';

export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  accessibilityLabel: string;
  fill: string;
  text: string;
  selected: boolean;
}

export type MapCommand =
  | {
      type: 'update';
      pins: MapPin[];
      selectedId: string | null;
      user: { latitude: number; longitude: number } | null;
      // Height of the bottom sheet, so centering and the location button stay in the visible area.
      bottomPadding: number;
      reduceMotion: boolean;
      dark: boolean;
    }
  | { type: 'center'; latitude: number; longitude: number };

export type MapEvent = { type: 'ready' } | { type: 'select'; id: string } | { type: 'error'; message: string };

export function parseMapEvent(data: unknown): MapEvent | null {
  try {
    const event = typeof data === 'string' ? JSON.parse(data) : data;
    return event && typeof event.type === 'string' ? (event as MapEvent) : null;
  } catch {
    return null;
  }
}

// Builds the `update` command from the screen's state. Shared by the WebView and iframe versions.
export function useMapUpdate(options: {
  events: NearbyEvent[];
  selectedId: string | null;
  user: { latitude: number; longitude: number } | null;
  bottomPadding: number;
  reduceMotion: boolean;
  dark: boolean;
  selectedFill: string;
  selectedText: string;
}): MapCommand {
  const { events, selectedId, user, bottomPadding, reduceMotion, dark, selectedFill, selectedText } = options;
  return useMemo(
    () => ({
      type: 'update',
      pins: events.map((event) => {
        const selected = event.id === selectedId;
        const tier = Tiers[event.difficultyTier];
        const xp = `${event.maxXp.toLocaleString()} XP`;
        return {
          id: event.id,
          latitude: event.location.latitude,
          longitude: event.location.longitude,
          label: xp,
          accessibilityLabel: `${event.title}, ${TIER_LABELS[event.difficultyTier]}, up to ${xp}`,
          fill: selected ? selectedFill : tier.fill,
          text: selected ? selectedText : tier.onFill,
          selected,
        };
      }),
      selectedId,
      user,
      bottomPadding: Math.round(bottomPadding),
      reduceMotion,
      dark,
    }),
    [events, selectedId, user, bottomPadding, reduceMotion, dark, selectedFill, selectedText],
  );
}

const CONFIG = {
  southWest: [NYC_BOUNDS.southWest.latitude, NYC_BOUNDS.southWest.longitude],
  northEast: [NYC_BOUNDS.northEast.latitude, NYC_BOUNDS.northEast.longitude],
  center: [NYC_REGION.latitude, NYC_REGION.longitude],
  zoom: 12,
  minZoom: NYC_MIN_ZOOM,
};

// The page itself. It runs in a browser engine, so it is plain JavaScript in a string.
export const LEAFLET_MAP_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&display=swap">
<style>
  html, body, #map { margin: 0; width: 100%; height: 100%; }
  body { background: #f2f2f2; -webkit-tap-highlight-color: transparent; }
  body.dark { background: #262626; }
  /* OpenStreetMap has no dark style, so dark mode inverts the tiles, keeping hues close to the original. */
  body.dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9); }
  .cp-icon { background: none; border: none; }
  .cp-pin { position: absolute; display: flex; flex-direction: column; align-items: center;
    transform: translate(-50%, -100%); cursor: pointer; }
  .cp-bubble { font-family: 'Lilita One', system-ui, sans-serif; font-size: 14px; line-height: 18px;
    padding: 3px 9px; border-radius: 12px; border: 2px solid #fff; white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
  .cp-pin.selected .cp-bubble { font-size: 18px; line-height: 22px; padding: 5px 12px;
    border-radius: 16px; border-width: 3px; }
  .cp-pointer { width: 0; height: 0; margin-top: -1px; border-left: 7px solid transparent;
    border-right: 7px solid transparent; border-top: 9px solid; }
  .cp-locate { width: 44px; height: 44px; border: none; border-radius: 22px; background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); font-size: 22px; line-height: 44px; color: #1A73E8;
    cursor: pointer; padding: 0; }
  body.dark .cp-locate { background: #263C4B; color: #8AB4F8; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
(function () {
  var config = ${JSON.stringify(CONFIG)};

  function send(message) {
    var data = JSON.stringify(message);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(data);
    else if (window.parent !== window) window.parent.postMessage(data, '*');
  }

  if (!window.L) {
    send({ type: 'error', message: 'The map could not load. Check your connection.' });
    return;
  }

  var bounds = L.latLngBounds(config.southWest, config.northEast);
  var map = L.map('map', {
    zoomControl: false,
    // Keep the map on the five boroughs.
    maxBounds: bounds.pad(0.05),
    maxBoundsViscosity: 1,
    minZoom: config.minZoom,
  }).setView(config.center, config.zoom);
  // The bottom sheet covers the bottom of the map, so credits go at the top.
  map.attributionControl.setPosition('topright');

  var state = { dark: null, selectedId: null, bottomPadding: 0, reduceMotion: false, user: null };
  var tiles = null;
  var markers = {};
  var userDot = null;

  function setTiles(dark) {
    if (state.dark === dark) return;
    state.dark = dark;
    if (!tiles) {
      tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
    }
    document.body.classList.toggle('dark', dark);
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pinHtml(pin) {
    return '<div class="cp-pin' + (pin.selected ? ' selected' : '') + '">' +
      '<div class="cp-bubble" style="background:' + escapeHtml(pin.fill) + ';color:' + escapeHtml(pin.text) + '">' +
      escapeHtml(pin.label) + '</div>' +
      '<div class="cp-pointer" style="border-top-color:' + escapeHtml(pin.fill) + '"></div></div>';
  }

  // Moves the map so a point sits in the middle of the area above the bottom sheet.
  function centerOn(latlng, zoom) {
    var z = zoom == null ? map.getZoom() : zoom;
    var point = map.project(latlng, z).add([0, state.bottomPadding / 2]);
    map.setView(map.unproject(point, z), z, { animate: !state.reduceMotion });
  }

  var Locate = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      var button = L.DomUtil.create('button', 'cp-locate');
      button.type = 'button';
      button.setAttribute('aria-label', 'Show my location');
      button.innerHTML = '&#9678;';
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, 'click', function () {
        if (state.user) centerOn(L.latLng(state.user.latitude, state.user.longitude), 15);
      });
      return button;
    },
  });
  var locate = new Locate().addTo(map);

  function update(message) {
    setTiles(message.dark);
    state.bottomPadding = message.bottomPadding;
    state.reduceMotion = message.reduceMotion;
    state.user = message.user;

    var seen = {};
    var selectedPin = null;
    message.pins.forEach(function (pin) {
      seen[pin.id] = true;
      if (pin.selected) selectedPin = pin;
      var html = pinHtml(pin);
      var marker = markers[pin.id];
      if (!marker) {
        marker = L.marker([pin.latitude, pin.longitude], { keyboard: true });
        marker.on('click', function () { send({ type: 'select', id: pin.id }); });
        marker.addTo(map);
        markers[pin.id] = marker;
      } else {
        marker.setLatLng([pin.latitude, pin.longitude]);
      }
      if (marker.cpHtml !== html) {
        marker.setIcon(L.divIcon({ className: 'cp-icon', html: html, iconSize: null }));
        marker.cpHtml = html;
      }
      // Keep the selected pin on top of any pins that overlap it.
      marker.setZIndexOffset(pin.selected ? 1000 : 0);
      var element = marker.getElement();
      if (element) {
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', pin.accessibilityLabel);
      }
    });
    Object.keys(markers).forEach(function (id) {
      if (!seen[id]) {
        map.removeLayer(markers[id]);
        delete markers[id];
      }
    });

    if (message.user) {
      var at = [message.user.latitude, message.user.longitude];
      if (!userDot) {
        userDot = L.circleMarker(at, {
          radius: 8, color: '#fff', weight: 3, fillColor: '#1A73E8', fillOpacity: 1, interactive: false,
        }).addTo(map);
      } else {
        userDot.setLatLng(at);
      }
    } else if (userDot) {
      map.removeLayer(userDot);
      userDot = null;
    }

    var button = locate.getContainer();
    button.style.display = message.user ? '' : 'none';
    button.style.marginBottom = (message.bottomPadding + 12) + 'px';

    // Pan to a newly selected pin, whether it was picked on the map or in the list.
    if (selectedPin && message.selectedId !== state.selectedId) {
      centerOn(L.latLng(selectedPin.latitude, selectedPin.longitude));
    }
    state.selectedId = message.selectedId;
  }

  function receive(data) {
    var message = typeof data === 'string' ? JSON.parse(data) : data;
    if (message.type === 'update') update(message);
    else if (message.type === 'center') centerOn(L.latLng(message.latitude, message.longitude), 14);
  }

  // The WebView calls this directly; the iframe sends messages from the parent page.
  window.cpReceive = receive;
  window.addEventListener('message', function (e) {
    if (window.parent === window || e.source !== window.parent) return;
    try { receive(e.data); } catch (err) {}
  });

  send({ type: 'ready' });
})();
</script>
</body>
</html>`;
