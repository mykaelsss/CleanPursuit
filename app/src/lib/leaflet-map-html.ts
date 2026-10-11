import { useMemo } from 'react';

import { Tiers } from '@/constants/theme';
import type { HotspotArea, NearbyEvent, NearbyQuest } from '@/lib/api';
import { TIER_LABELS } from '@/lib/event-format';
import { NYC_BOUNDS, NYC_MIN_ZOOM, NYC_REGION } from '@/lib/nyc';

// The quests map is a Leaflet page with OpenStreetMap's standard tiles, so it needs no API key.
// Phones load it in a WebView and web loads it in an iframe. The app and the page talk by messages:
// the app sends `MapCommand`s, and the page answers with `MapEvent`s.
//
// OpenStreetMap's tile servers block requests without a Referer (see their tile usage policy), so the
// WebView gives the page this address. Nothing is loaded from it; it only names the app in tile requests.
// The iframe on web shares the app's own address, which works the same way.
export const MAP_PAGE_URL = 'https://cleanpursuit.app/';

// Scheduled parties show as XP bubbles. Open quests with no party yet show as waypoints: a diamond
// with a "!", like a quest giver in a game. A spot where a walk-up cleanup is under way ripples.
export type PinKind = 'event' | 'quest';

export type MapSelection = { kind: PinKind; id: string };

export interface MapPin {
  kind: PinKind;
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  accessibilityLabel: string;
  fill: string;
  text: string;
  selected: boolean;
  // People are cleaning the spot now.
  live: boolean;
}

// A recently reported H3 area. It glows like an ember, brighter as more people report it, and shows its
// hexagon once the map is zoomed in far enough to see it.
export interface MapArea {
  id: string;
  latitude: number;
  longitude: number;
  boundary: [number, number][];
  reporters: number;
  hot: boolean;
}

export type MapCommand =
  | {
      type: 'update';
      pins: MapPin[];
      areas: MapArea[];
      selected: MapSelection | null;
      user: { latitude: number; longitude: number } | null;
      // Height of the bottom sheet, so centering and the location button stay in the visible area.
      bottomPadding: number;
      reduceMotion: boolean;
      dark: boolean;
    }
  | { type: 'center'; latitude: number; longitude: number };

export type MapEvent =
  | { type: 'ready' }
  | { type: 'select'; kind: PinKind; id: string }
  | { type: 'error'; message: string };

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
  quests: NearbyQuest[];
  hotspots: HotspotArea[];
  selected: MapSelection | null;
  user: { latitude: number; longitude: number } | null;
  bottomPadding: number;
  reduceMotion: boolean;
  dark: boolean;
  selectedFill: string;
  selectedText: string;
}): MapCommand {
  const { events, quests, hotspots, selected, user, bottomPadding, reduceMotion, dark, selectedFill, selectedText } =
    options;
  return useMemo(() => {
    const hot = new Set(hotspots.filter((area) => area.isHotspot).map((area) => area.areaId));
    const pin = (
      kind: PinKind,
      item: Pick<NearbyEvent, 'id' | 'title' | 'difficultyTier' | 'areaId' | 'location' | 'walkUp'>,
      label: string,
      reward: string,
    ): MapPin => {
      const isSelected = selected?.kind === kind && selected.id === item.id;
      const tier = Tiers[item.difficultyTier];
      const live = item.walkUp ? `live now, ${item.walkUp.checkedInCount} on site` : null;
      const spoken = [item.title, TIER_LABELS[item.difficultyTier], reward, live, hot.has(item.areaId) ? 'hotspot' : null];
      return {
        kind,
        id: item.id,
        latitude: item.location.latitude,
        longitude: item.location.longitude,
        label,
        accessibilityLabel: spoken.filter(Boolean).join(', '),
        fill: isSelected ? selectedFill : tier.fill,
        text: isSelected ? selectedText : tier.onFill,
        selected: isSelected,
        live: item.walkUp !== null,
      };
    };

    return {
      type: 'update',
      pins: [
        ...quests.map((quest) => pin('quest', quest, '!', quest.walkUp ? 'walk-up cleanup' : 'no party yet')),
        ...events.map((event) => {
          const xp = `${event.maxXp.toLocaleString()} XP`;
          return pin('event', event, xp, `party, up to ${xp}`);
        }),
      ],
      areas: hotspots.map((area) => ({
        id: area.areaId,
        latitude: area.latitude,
        longitude: area.longitude,
        boundary: area.boundary.map((corner): [number, number] => [corner.latitude, corner.longitude]),
        reporters: area.distinctReporters,
        hot: area.isHotspot,
      })),
      selected,
      user,
      bottomPadding: Math.round(bottomPadding),
      reduceMotion,
      dark,
    };
  }, [events, quests, hotspots, selected, user, bottomPadding, reduceMotion, dark, selectedFill, selectedText]);
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
  /* Waypoints: open quests with no party yet. The diamond sits on the spot; 44px keeps it easy to tap. */
  .cp-waypoint { position: absolute; width: 44px; height: 44px; transform: translate(-50%, -50%);
    display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .cp-diamond { position: absolute; width: 22px; height: 22px; transform: rotate(45deg);
    border-radius: 5px; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); }
  .cp-mark { position: relative; font-family: 'Lilita One', system-ui, sans-serif; font-size: 15px; line-height: 1; }
  .cp-waypoint.selected .cp-diamond { width: 30px; height: 30px; border-width: 3px; border-radius: 7px; }
  .cp-waypoint.selected .cp-mark { font-size: 20px; }
  /* Live: a walk-up cleanup is under way, so the spot ripples. Parties ripple at their pointer's tip. */
  .cp-live { position: absolute; width: 44px; height: 44px; border-radius: 50%; pointer-events: none;
    border: 3px solid #2BB673; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85);
    animation: cp-ripple 2s ease-out infinite; }
  .cp-pin .cp-live { bottom: -22px; left: 50%; margin-left: -22px; }
  body.cp-still .cp-live { animation: none; }
  @keyframes cp-ripple { 0% { transform: scale(0.75); opacity: 1; } 100% { transform: scale(1.35); opacity: 0.15; } }
  /* Reported areas glow like embers. Hotspots, reported by enough people to earn bonus XP, burn
     hotter and slowly breathe. Up close the glow steps back for the area's real hexagon. */
  .cp-heat { position: absolute; transform: translate(-50%, -50%); transition: opacity 0.3s; }
  .cp-heat-core { width: 100%; height: 100%; border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 150, 50, 0.6) 0%, rgba(255, 140, 50, 0.25) 40%, rgba(255, 140, 50, 0) 70%); }
  .cp-heat.hot .cp-heat-core { animation: cp-breathe 3.6s ease-in-out infinite;
    background: radial-gradient(circle, rgba(255, 80, 20, 0.85) 0%, rgba(255, 100, 30, 0.42) 38%, rgba(255, 120, 40, 0) 70%); }
  /* On dark tiles the glows add light, so they read as embers instead of muddy orange. */
  body.dark .leaflet-cpHeat-pane { mix-blend-mode: screen; }
  body.cp-still .cp-heat-core { animation: none; }
  body.cp-near .cp-heat { opacity: 0.35; }
  body:not(.cp-near) .cp-hex { display: none; }
  @keyframes cp-breathe { 0%, 100% { transform: scale(0.9); opacity: 0.8; } 50% { transform: scale(1.05); opacity: 1; } }
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

  // Glows sit above the tiles and below the hexagons and pins, and never take taps.
  var heatPane = map.createPane('cpHeat');
  heatPane.style.zIndex = 350;
  heatPane.style.pointerEvents = 'none';

  // Hexagons are about 150 m across, so they only show from this zoom, where they are big enough to read.
  var NEAR_ZOOM = 14;
  function syncZoom() {
    document.body.classList.toggle('cp-near', map.getZoom() >= NEAR_ZOOM);
  }
  map.on('zoomend', syncZoom);
  syncZoom();

  var state = { dark: null, selectedKey: null, bottomPadding: 0, reduceMotion: false, user: null };
  var tiles = null;
  var markers = {};
  var areas = {};
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
    var live = pin.live ? '<div class="cp-live"></div>' : '';
    if (pin.kind === 'quest') {
      return '<div class="cp-waypoint' + (pin.selected ? ' selected' : '') + '">' + live +
        '<div class="cp-diamond" style="background:' + escapeHtml(pin.fill) + '"></div>' +
        '<div class="cp-mark" style="color:' + escapeHtml(pin.text) + '">' + escapeHtml(pin.label) + '</div></div>';
    }
    return '<div class="cp-pin' + (pin.selected ? ' selected' : '') + '">' + live +
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

  // Bigger glows for areas more people reported, up to six.
  function heatSize(reporters) {
    return 56 + 14 * (Math.min(Math.max(reporters, 1), 6) - 1);
  }

  function updateAreas(list) {
    var seen = {};
    list.forEach(function (area) {
      seen[area.id] = true;
      var key = JSON.stringify(area);
      var existing = areas[area.id];
      if (existing && existing.key === key) return;
      if (existing) {
        map.removeLayer(existing.glow);
        map.removeLayer(existing.hex);
      }
      var size = heatSize(area.reporters);
      var glow = L.marker([area.latitude, area.longitude], {
        pane: 'cpHeat',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'cp-icon',
          iconSize: null,
          html: '<div class="cp-heat' + (area.hot ? ' hot' : '') + '" aria-hidden="true" style="width:' + size +
            'px;height:' + size + 'px"><div class="cp-heat-core"></div></div>',
        }),
      }).addTo(map);
      // Hotspots get a solid edge; areas still warming up get a dashed one.
      var hex = L.polygon(area.boundary, {
        className: 'cp-hex',
        interactive: false,
        color: area.hot ? '#E8400C' : '#F08C00',
        weight: area.hot ? 2.5 : 1.5,
        dashArray: area.hot ? null : '5 4',
        fillColor: area.hot ? '#FF5A1F' : '#FF9A3C',
        fillOpacity: area.hot ? 0.24 : 0.12,
      }).addTo(map);
      areas[area.id] = { key: key, glow: glow, hex: hex };
    });
    Object.keys(areas).forEach(function (id) {
      if (!seen[id]) {
        map.removeLayer(areas[id].glow);
        map.removeLayer(areas[id].hex);
        delete areas[id];
      }
    });
  }

  function update(message) {
    setTiles(message.dark);
    state.bottomPadding = message.bottomPadding;
    state.reduceMotion = message.reduceMotion;
    state.user = message.user;
    document.body.classList.toggle('cp-still', message.reduceMotion);
    updateAreas(message.areas);

    var seen = {};
    var selectedPin = null;
    message.pins.forEach(function (pin) {
      var key = pin.kind + ':' + pin.id;
      seen[key] = true;
      if (pin.selected) selectedPin = pin;
      var html = pinHtml(pin);
      var marker = markers[key];
      if (!marker) {
        marker = L.marker([pin.latitude, pin.longitude], { keyboard: true });
        marker.on('click', function () { send({ type: 'select', kind: pin.kind, id: pin.id }); });
        marker.addTo(map);
        markers[key] = marker;
      } else {
        marker.setLatLng([pin.latitude, pin.longitude]);
      }
      if (marker.cpHtml !== html) {
        marker.setIcon(L.divIcon({ className: 'cp-icon', html: html, iconSize: null }));
        marker.cpHtml = html;
      }
      // Keep the selected pin on top of any pins that overlap it, and parties above waypoints.
      marker.setZIndexOffset(pin.selected ? 1000 : pin.kind === 'event' ? 100 : 0);
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
    var selectedKey = message.selected ? message.selected.kind + ':' + message.selected.id : null;
    if (selectedPin && selectedKey !== state.selectedKey) {
      centerOn(L.latLng(selectedPin.latitude, selectedPin.longitude));
    }
    state.selectedKey = selectedKey;
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
