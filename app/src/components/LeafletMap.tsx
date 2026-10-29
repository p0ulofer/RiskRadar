import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { LEAFLET_CSS, LEAFLET_JS } from '@/lib/leaflet-assets';
import type { GeoRegion, Hotspot, Level } from '@/types/hotspots';
import type { TrafficCategory, TrafficIncident } from '@/types/traffic';

const INITIAL_BOUNDS = '[[-18.5, -48.5], [-1.0, -32.0]]';

interface LeafletMapProps {
  hotspots: Hotspot[];
  selected: Hotspot | null;
  focus: GeoRegion | null;
  focusKey?: string | null;
  colorForLevel: (level: Level) => string;
  backgroundColor: string;
  onSelect: (hotspot: Hotspot) => void;
  onRegionChange: (region: GeoRegion) => void;
  incidents?: TrafficIncident[];
  selectedIncident?: TrafficIncident | null;
  colorForTraffic?: (category: TrafficCategory) => string;
  onSelectIncident?: (incident: TrafficIncident) => void;
}

function zoomForDelta(delta: number): number {
  const safeDelta = Math.max(0.01, Math.min(360, delta));
  return Math.max(3, Math.min(16, Math.round(Math.log2(360 / safeDelta))));
}

function buildHtml(backgroundColor: string): string {
  // O JS do Leaflet não contém "</script>", mas escapamos por segurança.
  const leafletJs = LEAFLET_JS.replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>${LEAFLET_CSS}</style>
<style>
  html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; background: ${backgroundColor}; }
  .leaflet-container { background: ${backgroundColor}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .leaflet-control-attribution { font-size: 9px; }
</style>
</head>
<body>
<div id="map" aria-label="Mapa de hotspots"></div>
<script>${leafletJs}</script>
<script>
(function () {
  var initialBounds = L.latLngBounds(${INITIAL_BOUNDS});
  var map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true, minZoom: 4 });
  map.fitBounds(initialBounds, { padding: [8, 8] });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  map.attributionControl.addAttribution('Incidentes: &copy; TomTom');
  var markers = [];
  var circle = null;
  var incidentLayer = L.layerGroup().addTo(map);
  function post(payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  window.riskradarUpdate = function (data) {
    markers.forEach(function (marker) { map.removeLayer(marker); });
    markers = [];
    (data.hotspots || []).forEach(function (hotspot) {
      var marker = L.circleMarker([hotspot.lat, hotspot.lng], {
        radius: hotspot.id === data.selectedId ? 9 : 6,
        color: '#ffffff',
        weight: 1.5,
        fillColor: hotspot.color,
        fillOpacity: 1
      }).addTo(map);
      marker.on('click', function () { post({ type: 'select', id: hotspot.id }); });
      markers.push(marker);
    });
    if (circle) { map.removeLayer(circle); circle = null; }
    if (data.selected) {
      circle = L.circle([data.selected.lat, data.selected.lng], {
        radius: data.selected.radius_m,
        color: data.selected.color,
        weight: 2,
        fillColor: data.selected.color,
        fillOpacity: 0.15
      }).addTo(map);
    }
  };
  window.riskradarUpdateIncidents = function (data) {
    incidentLayer.clearLayers();
    (data.incidents || []).forEach(function (incident) {
      var selected = incident.id === data.selectedId;
      var shape;
      if (incident.line && incident.line.length > 1) {
        shape = L.polyline(incident.line, {
          color: incident.color,
          weight: selected ? 6 : 4,
          opacity: selected ? 1 : 0.85
        });
      } else {
        shape = L.circleMarker([incident.lat, incident.lng], {
          radius: selected ? 10 : 7,
          color: '#ffffff',
          weight: 2,
          fillColor: incident.color,
          fillOpacity: 1
        });
      }
      shape.on('click', function () { post({ type: 'selectIncident', id: incident.id }); });
      shape.addTo(incidentLayer);
    });
  };
  window.riskradarFocus = function (lat, lng, zoom) {
    window.riskradarHasFocused = true;
    map.setView([lat, lng], zoom || map.getZoom());
  };
  function postRegion() {
    var center = map.getCenter();
    var bounds = map.getBounds();
    post({
      type: 'region',
      latitude: center.lat,
      longitude: center.lng,
      latitudeDelta: Math.abs(bounds.getNorth() - bounds.getSouth()),
      longitudeDelta: Math.abs(bounds.getEast() - bounds.getWest())
    });
  }
  map.on('moveend', postRegion);
  window.addEventListener('resize', function () { map.invalidateSize(); });
  setTimeout(function () {
    map.invalidateSize();
    if (!window.riskradarHasFocused) map.fitBounds(initialBounds, { padding: [8, 8] });
  }, 250);
  post({ type: 'ready' });
  postRegion();
})();
</script>
</body>
</html>`;
}

export function LeafletMap({
  hotspots,
  selected,
  focus,
  focusKey,
  colorForLevel,
  backgroundColor,
  onSelect,
  onRegionChange,
  incidents = [],
  selectedIncident = null,
  colorForTraffic,
  onSelectIncident,
}: LeafletMapProps) {
  const webRef = useRef<WebView | null>(null);
  const lastFocusRef = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const html = useMemo(() => buildHtml(backgroundColor), [backgroundColor]);

  useEffect(() => {
    if (loaded || failed) return;
    const timer = setTimeout(() => setTimedOut(true), 12_000);
    return () => clearTimeout(timer);
  }, [loaded, failed, reloadKey]);

  const payload = useMemo(
    () =>
      JSON.stringify({
        hotspots: hotspots.map((hotspot) => ({
          id: hotspot.id,
          lat: hotspot.lat,
          lng: hotspot.lng,
          color: colorForLevel(hotspot.level),
        })),
        selectedId: selected?.id ?? null,
        selected: selected
          ? {
              lat: selected.lat,
              lng: selected.lng,
              radius_m: selected.radius_m,
              color: colorForLevel(selected.level),
            }
          : null,
      }),
    [hotspots, selected, colorForLevel]
  );

  useEffect(() => {
    if (!loaded) return;
    webRef.current?.injectJavaScript(`window.riskradarUpdate(${payload}); true;`);
  }, [loaded, payload]);

  const incidentPayload = useMemo(
    () =>
      JSON.stringify({
        incidents: incidents.map((incident) => ({
          id: incident.id,
          lat: incident.lat,
          lng: incident.lng,
          color: colorForTraffic ? colorForTraffic(incident.category) : '#C62828',
          line: incident.geometry.length > 1 ? incident.geometry : null,
        })),
        selectedId: selectedIncident?.id ?? null,
      }),
    [incidents, selectedIncident, colorForTraffic]
  );

  useEffect(() => {
    if (!loaded) return;
    webRef.current?.injectJavaScript(`window.riskradarUpdateIncidents(${incidentPayload}); true;`);
  }, [loaded, incidentPayload]);

  useEffect(() => {
    if (!loaded || !focus) return;
    const key = `${focusKey ?? ''}:${focus.latitude.toFixed(5)}:${focus.longitude.toFixed(5)}`;
    if (lastFocusRef.current === key) return;
    lastFocusRef.current = key;
    const zoom = zoomForDelta(focus.longitudeDelta);
    webRef.current?.injectJavaScript(
      `window.riskradarFocus(${focus.latitude}, ${focus.longitude}, ${zoom}); true;`
    );
  }, [loaded, focus, focusKey]);

  const handleMessage = (event: WebViewMessageEvent) => {
    let message: unknown;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const data = message as Record<string, unknown>;
    if (data.type === 'ready') {
      setTimedOut(false);
      setLoaded(true);
      return;
    }
    if (data.type === 'select' && typeof data.id === 'string') {
      const hotspot = hotspots.find((item) => item.id === data.id);
      if (hotspot) onSelect(hotspot);
      return;
    }
    if (data.type === 'selectIncident' && typeof data.id === 'string') {
      const incident = incidents.find((item) => item.id === data.id);
      if (incident) onSelectIncident?.(incident);
      return;
    }
    if (
      data.type === 'region' &&
      typeof data.latitude === 'number' &&
      typeof data.longitude === 'number' &&
      typeof data.latitudeDelta === 'number' &&
      typeof data.longitudeDelta === 'number'
    ) {
      onRegionChange({
        latitude: data.latitude,
        longitude: data.longitude,
        latitudeDelta: data.latitudeDelta,
        longitudeDelta: data.longitudeDelta,
      });
    }
  };

  const retry = () => {
    setFailed(false);
    setTimedOut(false);
    setLoaded(false);
    lastFocusRef.current = null;
    setReloadKey((value) => value + 1);
  };

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <WebView
        key={reloadKey}
        ref={webRef}
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        applicationNameForUserAgent="RiskRadar/1.0"
        setSupportMultipleWindows={false}
        onMessage={handleMessage}
        onError={() => setFailed(true)}
        accessibilityLabel="Mapa de hotspots nas rodovias federais do Nordeste"
      />
      {!loaded && !failed && !timedOut ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#0B3D5C" />
          <Text style={styles.overlayText}>Carregando mapa…</Text>
        </View>
      ) : null}
      {failed || timedOut ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Não foi possível carregar o mapa</Text>
          <Text style={styles.overlayText}>
            Verifique a conexão. Os hotspots continuam disponíveis na aba “Perto de mim”.
          </Text>
          <Pressable onPress={retry} style={styles.retryButton} accessibilityRole="button">
            <Text style={styles.retryText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
    backgroundColor: 'rgba(247, 249, 251, 0.92)',
  },
  overlayText: {
    fontSize: 13,
    color: '#44515C',
    textAlign: 'center',
    lineHeight: 18,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#13212B',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 6,
    backgroundColor: '#0B3D5C',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
