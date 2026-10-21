"""Enriquecimento opcional dos hotspots com infraestrutura do OpenStreetMap.

A consulta é feita **por hotspot** (não por acidente) à Overpass API, sempre
agrupando vários hotspots por requisição. O resultado fica em cache em disco
para que uma nova execução não repita consultas já feitas.

Falhas de rede não interrompem o pipeline: o chamador decide se segue sem o
campo ``infra`` (schema 1) ou aborta o enriquecimento.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Callable, Iterable, Sequence

import pandas as pd
import requests

from . import config
from .cluster import haversine_m

logger = logging.getLogger(__name__)

INFRA_KEYS = ("traffic_signals", "crossing", "traffic_calming", "speed_camera")
HIGHWAY_CLASSES = ("traffic_signals", "crossing", "speed_camera")
# O espelho openstreetmap.fr só aceita User-Agents simples na lista dele;
# um UA com parênteses/descrição recebe 403 "white-listed usages".
USER_AGENT = "RiskRadar/1.0"


def _format_coord(value: float) -> str:
    return f"{float(value):.6f}"


def build_query(hotspots: Sequence[dict], padding_m: int = config.OSM_RADIUS_PADDING_M) -> str:
    """Monta uma consulta Overpass com um ``around`` por hotspot do lote."""
    lines = [f"[out:json][timeout:{config.OSM_TIMEOUT_S}];", "("]
    for hotspot in hotspots:
        radius = int(round(float(hotspot["radius_m"]) + padding_m))
        lat = _format_coord(hotspot["lat"])
        lng = _format_coord(hotspot["lng"])
        pattern = "|".join(HIGHWAY_CLASSES)
        lines.append(f'  nwr(around:{radius},{lat},{lng})["highway"~"^({pattern})$"];')
        lines.append(f'  nwr(around:{radius},{lat},{lng})["traffic_calming"];')
    lines.append(");")
    lines.append("out center tags;")
    return "\n".join(lines)


def element_coordinates(element: dict) -> tuple[float, float] | None:
    """Extrai coordenadas de um nó ou do centro de uma via/relação."""
    try:
        if "lat" in element and "lon" in element:
            return float(element["lat"]), float(element["lon"])
        center = element.get("center")
        if isinstance(center, dict) and "lat" in center and "lon" in center:
            return float(center["lat"]), float(center["lon"])
    except (TypeError, ValueError):
        return None
    return None


def element_kind(tags: dict | None) -> str | None:
    """Classifica um elemento OSM em uma das quatro categorias contadas."""
    if not isinstance(tags, dict):
        return None
    highway = tags.get("highway")
    if highway in HIGHWAY_CLASSES:
        return str(highway)
    calming = tags.get("traffic_calming")
    if calming and calming != "no":
        return "traffic_calming"
    return None


def parse_elements(elements: Iterable[dict]) -> list[tuple[float, float, str]]:
    """Converte elementos da Overpass em ``(lat, lng, tipo)``, sem duplicatas."""
    parsed: list[tuple[float, float, str]] = []
    seen: set[tuple[str, int]] = set()
    for element in elements:
        if not isinstance(element, dict):
            continue
        key = (str(element.get("type")), int(element.get("id", 0) or 0))
        if key in seen:
            continue
        kind = element_kind(element.get("tags"))
        if kind is None:
            continue
        coordinates = element_coordinates(element)
        if coordinates is None:
            continue
        seen.add(key)
        parsed.append((coordinates[0], coordinates[1], kind))
    return parsed


def _empty_counts() -> dict[str, int]:
    return {key: 0 for key in INFRA_KEYS}


def count_infra(
    elements: Iterable[dict],
    hotspots: Sequence[dict],
    padding_m: int = config.OSM_RADIUS_PADDING_M,
) -> list[dict[str, int]]:
    """Conta a infraestrutura dentro do raio de cada hotspot do lote.

    Um mesmo elemento pode ser contado em dois hotspots se os raios se
    sobrepuserem, o que é intencional: cada hotspot descreve a sua área.
    """
    parsed = parse_elements(elements)
    result: list[dict[str, int]] = []
    for hotspot in hotspots:
        counts = _empty_counts()
        limit = float(hotspot["radius_m"]) + padding_m
        lat = float(hotspot["lat"])
        lng = float(hotspot["lng"])
        for element_lat, element_lng, kind in parsed:
            if float(haversine_m(lat, lng, element_lat, element_lng)) <= limit:
                counts[kind] += 1
        result.append(counts)
    return result


class OverpassClient:
    """Cliente Overpass com throttle, retry com backoff e cache em disco."""

    def __init__(
        self,
        endpoint: str = config.OSM_OVERPASS_URL,
        cache_dir: str | Path | None = None,
        pause_s: float = config.OSM_PAUSE_S,
        timeout_s: float = config.OSM_TIMEOUT_S,
        retries: int = config.OSM_RETRIES,
        session: requests.Session | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.endpoint = endpoint
        self.cache_dir = Path(cache_dir) if cache_dir else Path(config.OSM_CACHE_DIR)
        self.pause_s = max(0.0, float(pause_s))
        self.timeout_s = float(timeout_s)
        self.retries = max(0, int(retries))
        self._session = session or requests.Session()
        self._sleep = sleep
        self._monotonic = monotonic
        self._last_request: float | None = None

    def _cache_path(self, query: str) -> Path:
        digest = hashlib.sha1(query.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.json"

    def _write_cache(self, path: Path, elements: list) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"elements": elements}, ensure_ascii=False), encoding="utf-8"
        )
        temporary.replace(path)

    def _throttle(self) -> None:
        if self.pause_s <= 0:
            self._last_request = self._monotonic()
            return
        now = self._monotonic()
        if self._last_request is not None:
            remaining = self.pause_s - (now - self._last_request)
            if remaining > 0:
                self._sleep(remaining)
        self._last_request = self._monotonic()

    def fetch(self, query: str) -> list[dict]:
        """Executa a consulta e devolve os elementos; usa cache quando possível."""
        cache_path = self._cache_path(query)
        if cache_path.exists():
            try:
                payload = json.loads(cache_path.read_text(encoding="utf-8"))
                elements = payload["elements"]
                if isinstance(elements, list):
                    logger.debug("Cache OSM: %s", cache_path.name)
                    return elements
            except (OSError, ValueError, KeyError):
                logger.warning("Cache OSM corrompido; removendo %s", cache_path)
                cache_path.unlink(missing_ok=True)

        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            self._throttle()
            try:
                response = self._session.post(
                    self.endpoint,
                    data={"data": query},
                    timeout=self.timeout_s,
                    headers={"User-Agent": USER_AGENT},
                )
                if response.status_code in {403, 429} or response.status_code >= 500:
                    snippet = str(getattr(response, "text", ""))[:160].replace("\n", " ")
                    raise requests.HTTPError(
                        f"Overpass respondeu HTTP {response.status_code}: {snippet}",
                        response=response,
                    )
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict) or not isinstance(payload.get("elements"), list):
                    raise ValueError("Resposta da Overpass sem lista 'elements'")
                elements = payload["elements"]
                self._write_cache(cache_path, elements)
                return elements
            except (requests.RequestException, ValueError, KeyError) as exc:
                last_error = exc
                if attempt >= self.retries:
                    break
                # 403/429 costumam indicar limite de taxa: espera mais tempo.
                backoff = min(5.0 * (2.0**attempt), 120.0)
                logger.warning(
                    "Falha na Overpass (%s); tentando de novo em %.0fs", exc, backoff
                )
                self._sleep(backoff)

        raise RuntimeError(
            f"Overpass falhou após {self.retries + 1} tentativa(s): {last_error}"
        )


def enrich_hotspots(
    hotspots: pd.DataFrame,
    client: OverpassClient | None = None,
    batch_size: int = config.OSM_BATCH_SIZE,
    padding_m: int = config.OSM_RADIUS_PADDING_M,
    max_consecutive_failures: int = config.OSM_MAX_CONSECUTIVE_FAILURES,
) -> pd.DataFrame:
    """Adiciona a coluna ``infra`` a cada hotspot consultando a Overpass.

    Hotspots são ordenados geograficamente antes do agrupamento para que cada
    lote cubra uma área compacta. Se um lote falhar, o erro é registrado e o
    processo tenta o próximo; após ``max_consecutive_failures`` falhas seguidas
    uma ``RuntimeError`` é levantada (o cache preserva o que já deu certo).
    """
    required = {"lat", "lng", "radius_m"}
    missing = required.difference(hotspots.columns)
    if missing:
        raise ValueError(f"Hotspots sem colunas obrigatórias: {sorted(missing)}")

    work = hotspots.reset_index(drop=True).copy()
    if work.empty:
        work["infra"] = pd.Series(dtype=object)
        return work

    client = client or OverpassClient()
    if batch_size < 1:
        raise ValueError("batch_size deve ser >= 1")

    points = [
        {
            "lat": float(row.lat),
            "lng": float(row.lng),
            "radius_m": int(row.radius_m),
        }
        for row in work[["lat", "lng", "radius_m"]].itertuples(index=False)
    ]
    order = sorted(
        range(len(points)),
        key=lambda index: (
            round(points[index]["lat"], 3),
            round(points[index]["lng"], 3),
            index,
        ),
    )

    infras: list[dict[str, int] | None] = [None] * len(points)
    consecutive_failures = 0
    for start in range(0, len(order), batch_size):
        batch_indexes = order[start : start + batch_size]
        batch = [points[index] for index in batch_indexes]
        try:
            elements = client.fetch(build_query(batch, padding_m=padding_m))
            counts = count_infra(elements, batch, padding_m=padding_m)
        except Exception as exc:  # rede, HTTP, cache, JSON: o chamador decide
            consecutive_failures += 1
            logger.warning(
                "Lote OSM %d–%d falhou (%s)",
                start + 1,
                start + len(batch),
                exc,
            )
            if consecutive_failures >= max_consecutive_failures:
                raise RuntimeError(
                    "Enriquecimento OSM abortado após "
                    f"{consecutive_failures} lotes consecutivos com falha: {exc}"
                ) from exc
            continue
        consecutive_failures = 0
        for index, counts_for_hotspot in zip(batch_indexes, counts):
            infras[index] = counts_for_hotspot
        logger.info("Lote OSM %d–%d concluído", start + 1, start + len(batch))

    if any(infra is None for infra in infras):
        missing_count = sum(infra is None for infra in infras)
        logger.warning("%d hotspot(s) ficaram sem dados de infraestrutura", missing_count)

    work["infra"] = [
        infra if infra is not None else _empty_counts() for infra in infras
    ]
    return work


def infra_totals(hotspots: pd.DataFrame) -> dict[str, int]:
    """Soma a infraestrutura de todos os hotspots (para logs e relatórios)."""
    totals = _empty_counts()
    if "infra" not in hotspots.columns:
        return totals
    for infra in hotspots["infra"]:
        if not isinstance(infra, dict):
            continue
        for key in INFRA_KEYS:
            totals[key] += int(infra.get(key, 0) or 0)
    return totals
