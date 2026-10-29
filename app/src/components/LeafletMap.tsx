import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { LEAFLET_CSS, LEAFLET_JS } from '@/lib/leaflet-assets';
import type { GeoPoint, GeoRegion, Hotspot, Level } from '@/types/hotspots';
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
  /** Posição atual do usuário, exibida como ícone azul no mapa. */
  userPosition?: GeoPoint | null;
  /** Incrementa para centralizar o mapa na posição do usuário. */
  userFocusToken?: number;
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
</style>
</head>
<body>
<div id="map" aria-label="Mapa de hotspots"></div>
<script>${leafletJs}</script>
<script>
(function () {
  var initialBounds = L.latLngBounds(${INITIAL_BOUNDS});
  // Atribuições (OpenStreetMap/ODbL e TomTom) ficam na tela "Sobre" do app.
  var map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: true, minZoom: 4 });
  map.fitBounds(initialBounds, { padding: [8, 8] });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  var markers = [];
  var circle = null;
  var incidentLayer = L.layerGroup().addTo(map);
  var HIT_RADIUS_PX = 18;
  var HIT_LINE_WEIGHT_PX = 24;
  function post(payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  // Camada invisível maior que o marcador: melhora o toque sem mudar o visual.
  function hitCircle(latlng, onClick) {
    var hit = L.circleMarker(latlng, {
      radius: HIT_RADIUS_PX,
      stroke: false,
      fill: true,
      fillColor: '#000000',
      fillOpacity: 0,
      opacity: 0
    });
    hit.on('click', onClick);
    return hit;
  }
  function hitLine(line, onClick) {
    var hit = L.polyline(line, {
      color: '#000000',
      weight: HIT_LINE_WEIGHT_PX,
      opacity: 0
    });
    hit.on('click', onClick);
    return hit;
  }
  window.riskradarUpdate = function (data) {
    markers.forEach(function (marker) { map.removeLayer(marker); });
    markers = [];
    (data.hotspots || []).forEach(function (hotspot) {
      var latlng = [hotspot.lat, hotspot.lng];
      var onClick = function () { post({ type: 'select', id: hotspot.id }); };
      var hit = hitCircle(latlng, onClick).addTo(map);
      var marker = L.circleMarker(latlng, {
        radius: hotspot.id === data.selectedId ? 9 : 6,
        color: '#ffffff',
        weight: 1.5,
        fillColor: hotspot.color,
        fillOpacity: 1
      }).addTo(map);
      marker.on('click', onClick);
      markers.push(hit, marker);
    });
    if (typeof data.userLat === 'number' && typeof data.userLng === 'number') {
      var userLatlng = [data.userLat, data.userLng];
      var userHalo = L.circleMarker(userLatlng, {
        radius: 18,
        stroke: false,
        fill: true,
        fillColor: '#1A73E8',
        fillOpacity: 0.18,
        interactive: false
      }).addTo(map);
      var userMarker = L.circleMarker(userLatlng, {
        radius: 7,
        stroke: true,
        weight: 3,
        color: '#FFFFFF',
        fill: true,
        fillColor: '#1A73E8',
        fillOpacity: 1,
        interactive: false
      }).addTo(map);
      markers.push(userHalo, userMarker);
    }
    if (circle) { map.removeLayer(circle); circle = null; }
    if (data.selected) {
      circle = L.circle([data.selected.lat, data.selected.lng], {
        radius: data.selected.radius_m,
        color: data.selected.color,
        weight: 2,
        fillColor: data.selected.color,
        fillOpacity: 0.15,
        interactive: false
      }).addTo(map);
    }
  };
  window.riskradarUpdateIncidents = function (data) {
    incidentLayer.clearLayers();
    (data.incidents || []).forEach(function (incident) {
      var selected = incident.id === data.selectedId;
      var onClick = function () { post({ type: 'selectIncident', id: incident.id }); };
      var shape;
      if (incident.line && incident.line.length > 1) {
        hitLine(incident.line, onClick).addTo(incidentLayer);
        shape = L.polyline(incident.line, {
          color: incident.color,
          weight: selected ? 6 : 4,
          opacity: selected ? 1 : 0.85
        }).addTo(incidentLayer);
      } else {
        hitCircle([incident.lat, incident.lng], onClick).addTo(incidentLayer);
        shape = L.circleMarker([incident.lat, incident.lng], {
          radius: selected ? 10 : 7,
          color: '#ffffff',
          weight: 2,
          fillColor: incident.color,
          fillOpacity: 1
        }).addTo(incidentLayer);
      }
      shape.on('click', onClick);
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
  userPosition = null,
  userFocusToken,
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
        userLat: userPosition?.latitude ?? null,
        userLng: userPosition?.longitude ?? null,
      }),
    [hotspots, selected, colorForLevel, userPosition]
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

  // Centraliza o mapa na posição do usuário quando o botão é acionado.
  const lastUserFocusRef = useRef<number>(0);
  useEffect(() => {
    if (!loaded) return;
    if (!userFocusToken || userFocusToken <= 0) return;
    if (lastUserFocusRef.current === userFocusToken) return;
    if (!userPosition) return;
    lastUserFocusRef.current = userFocusToken;
    webRef.current?.injectJavaScript(
      `window.riskradarFocus(${userPosition.latitude}, ${userPosition.longitude}, 14); true;`
    );
  }, [loaded, userFocusToken, userPosition]);

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
