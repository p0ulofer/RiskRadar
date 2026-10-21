"""Detecção de hotspots de acidentes (haversine).

Cada par (UF, BR) é processado separadamente para nunca fundir rodovias
distintas.

Método: **picos de densidade** com supressão de sobreposição.

1. Para cada acidente, conta-se quantos existem num raio de 300 m
   (a mesma definição de núcleo do DBSCAN com ``eps=300`` e ``min_samples=5``).
2. Os acidentes com contagem >= ``HOTSPOT_MIN_SAMPLES`` são candidatos a pico.
3. Candidatos são ordenados por densidade (maior primeiro) e greedy: um pico é
   aceito só se nenhum pico já aceito estiver a menos de 300 m dele.
4. Cada acidente é atribuído ao pico aceito mais próximo (até 300 m), o que
   impede contagem dupla. Trechos que perdem pontos para um pico mais denso e
   ficam com menos de ``HOTSPOT_MIN_SAMPLES`` acidentes são descartados.

Por que não DBSCAN puro: o DBSCAN conecta acidentes vizinhos por
densidade-alcançável, então numa rodovia movimentada os pontos se encadeiam e
80 km de BR-101 viram um único "hotspot" de milhares de acidentes, com o
marcador desenhado no centroide (longe da concentração real). O método de
picos mantém exatamente a regra da missão — "mais de 5 acidentes num raio de
300 m" — sem o efeito de corrente.
"""

from __future__ import annotations

import logging
from collections import Counter

import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

from . import config

logger = logging.getLogger(__name__)


def haversine_m(
    lat1: np.ndarray | float,
    lng1: np.ndarray | float,
    lat2: np.ndarray | float,
    lng2: np.ndarray | float,
) -> np.ndarray:
    """Distância haversine em metros entre pontos (graus decimais)."""
    lat1r = np.radians(lat1)
    lng1r = np.radians(lng1)
    lat2r = np.radians(lat2)
    lng2r = np.radians(lng2)
    dlat = lat2r - lat1r
    dlng = lng2r - lng1r
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1r) * np.cos(lat2r) * np.sin(dlng / 2.0) ** 2
    return 2.0 * config.EARTH_RADIUS_M * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def _mode(values: pd.Series) -> str:
    values = values.dropna().astype(str)
    values = values[values.str.strip() != ""]
    if values.empty:
        return ""
    return str(values.value_counts().idxmax())


def _top_counts(values: pd.Series, limit: int = config.TOP_ITEMS) -> list[dict]:
    values = values.dropna().astype(str).str.strip()
    values = values[values != ""]
    if values.empty:
        return []
    counts = values.value_counts().head(limit)
    return [{"nome": str(name), "n": int(count)} for name, count in counts.items()]


def _counts_by(values: pd.Series) -> dict:
    values = values.dropna().astype(str).str.strip()
    values = values[values != ""]
    counts = Counter(values.tolist())
    return {str(key): int(count) for key, count in sorted(counts.items())}


def _coords(subset: pd.DataFrame) -> np.ndarray:
    """Coordenadas em radianos (métrica haversine do scikit-learn)."""
    return np.radians(subset[["latitude", "longitude"]].to_numpy(dtype=float))


def _density_counts(subset: pd.DataFrame, radius_m: float) -> np.ndarray:
    """Para cada acidente, quantos existem a até ``radius_m`` (incluindo ele)."""
    coords = _coords(subset)
    tree = BallTree(coords, metric="haversine")
    counts = tree.query_radius(coords, r=radius_m / config.EARTH_RADIUS_M, count_only=True)
    return np.asarray(counts, dtype=int)


def _select_peaks(
    subset: pd.DataFrame,
    densities: np.ndarray,
    radius_m: float,
    min_samples: int,
    separation_m: float,
) -> np.ndarray:
    """Seleciona picos de densidade sem sobreposição (supressão não máxima).

    Candidatos são os acidentes com pelo menos ``min_samples`` acidentes no
    raio. Entra primeiro o mais denso; um candidato é aceito apenas se não
    houver pico aceito a menos de ``separation_m`` dele. É isso que impede a
    "corrente" ao longo da rodovia: cada pico vira um trecho local.
    """
    lats = subset["latitude"].to_numpy(dtype=float)
    lngs = subset["longitude"].to_numpy(dtype=float)
    candidates = np.flatnonzero(densities >= min_samples)
    # Desempate determinístico: densidade decrescente, depois posição.
    order = sorted(candidates.tolist(), key=lambda i: (-int(densities[i]), lats[i], lngs[i]))

    peaks: list[int] = []
    for index in order:
        if peaks:
            distances = haversine_m(lats[index], lngs[index], lats[peaks], lngs[peaks])
            if bool(np.any(distances <= separation_m)):
                continue
        peaks.append(index)
    return np.array(peaks, dtype=int)


def _neighborhoods(
    subset: pd.DataFrame, peaks: np.ndarray, radius_m: float
) -> tuple[dict[int, list[int]], np.ndarray]:
    """Acidentes a até ``radius_m`` de cada pico, e a máscara dos cobertos.

    As vizinhanças podem se sobrepor levemente (picos ficam a 300 m ou mais),
    como em um mapa de densidade: um acidente perto da fronteira pode contar
    para dois trechos vizinhos. Por isso a contagem de acidentes por hotspot é
    a densidade local (regra da missão) e não uma partição dos acidentes.
    """
    coords = _coords(subset)
    if len(peaks) == 0:
        return {}, np.zeros(len(subset), dtype=bool)
    peak_tree = BallTree(coords[peaks], metric="haversine")
    radius_rad = radius_m / config.EARTH_RADIUS_M
    neighbors = peak_tree.query_radius(coords, r=radius_rad)
    covered = np.zeros(len(subset), dtype=bool)
    members: dict[int, list[int]] = {int(peak): [] for peak in peaks.tolist()}
    for point, peak_indexes in enumerate(neighbors):
        for position in np.asarray(peak_indexes, dtype=int).ravel():
            peak = int(peaks[position])
            members[peak].append(point)
            covered[point] = True
    return members, covered


def _km_summary(km: pd.Series) -> tuple[float, float, float]:
    """(km_min, km_max, km_mediana) robustos para descrever o trecho.

    O km reportado pela PRF nem sempre é consistente: a mesma coordenada
    aparece com numerações diferentes (a BR-116/BA, por exemplo, tem trechos
    com contagem de km reiniciada). Por isso usamos o grupo dominante de km
    (janela de 1 km em torno do valor mais frequente) e, dentro dele, os
    percentis 10–90 e a mediana.
    """
    values = km.dropna().to_numpy(dtype=float)
    if values.size == 0:
        return 0.0, 0.0, 0.0
    counts = pd.Series(np.round(values)).value_counts()
    mode_km = float(counts.index[0])
    dominant = values[np.abs(values - mode_km) <= config.KM_GROUP_TOLERANCE_KM]
    if dominant.size < 3:
        # Sem grupo dominante com pelo menos 3 acidentes: a dispersão é real.
        dominant = values
    low = float(np.percentile(dominant, config.KM_PERCENTILE_LOW))
    high = float(np.percentile(dominant, config.KM_PERCENTILE_HIGH))
    median = float(np.median(dominant))
    return low, high, median


def _cluster_record(group: pd.DataFrame) -> dict:
    lats = group["latitude"].to_numpy(dtype=float)
    lngs = group["longitude"].to_numpy(dtype=float)
    center_lat = float(lats.mean())
    center_lng = float(lngs.mean())
    distances = haversine_m(center_lat, center_lng, lats, lngs)
    radius = float(np.percentile(distances, config.RADIUS_PERCENTILE))
    radius = float(np.clip(radius, config.RADIUS_MIN_M, config.RADIUS_MAX_M))

    # A coordenada da PRF é georreferenciada ao trecho da rodovia, não ao GPS do
    # acidente: muitos acidentes caem no mesmo ponto e o km reportado varia
    # dentro dele. Por isso o trecho é descrito por percentis (10–90) e pela
    # mediana do grupo dominante, e não pelo mínimo/máximo (que viravam
    # "km 1–88" num só ponto).
    km_min, km_max, km_mediana = _km_summary(group["km"])

    return {
        "lat": center_lat,
        "lng": center_lng,
        "radius_m": int(round(radius)),
        "uf": str(group["uf"].iloc[0]),
        "br": int(group["br"].iloc[0]),
        "municipio": _mode(group["municipio"]),
        "km_min": round(km_min, 1),
        "km_max": round(km_max, 1),
        "km_mediana": round(km_mediana, 1),
        "n_acidentes": int(len(group)),
        "mortos": int(group["mortos"].sum()),
        "feridos_graves": int(group["feridos_graves"].sum()),
        "feridos_leves": int(group["feridos_leves"].sum()),
        "ilesos": int(group["ilesos"].sum()),
        "score": int(group["pontos"].sum()),
        "top_causas": _top_counts(group["causa_acidente"]),
        "top_tipos": _top_counts(group["tipo_acidente"]),
        "fase_dia": _counts_by(group["fase_dia"]),
        "por_ano": _counts_by(group["ano"].astype(int).astype(str)),
    }


def cluster_hotspots(df: pd.DataFrame) -> pd.DataFrame:
    """Executa DBSCAN por (UF, BR) e devolve um DataFrame de hotspots.

    Espera as colunas ``latitude``, ``longitude``, ``pontos`` e os agregados.
    """
    if df.empty:
        return pd.DataFrame()
    required = {"latitude", "longitude", "uf", "br", "pontos"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Colunas ausentes para clusterização: {sorted(missing)}")

    records: list[dict] = []
    noise_total = 0
    groups = 0
    for (uf, br), group in df.groupby(["uf", "br"], sort=True):
        groups += 1
        if len(group) < config.HOTSPOT_MIN_SAMPLES:
            noise_total += len(group)
            continue

        densities = _density_counts(group, config.HOTSPOT_RADIUS_M)
        peaks = _select_peaks(
            group,
            densities,
            config.HOTSPOT_RADIUS_M,
            config.HOTSPOT_MIN_SAMPLES,
            config.PEAK_MIN_SEPARATION_M,
        )
        members_by_peak, covered = _neighborhoods(
            group, peaks, config.HOTSPOT_RADIUS_M
        )

        for members in members_by_peak.values():
            if len(members) < config.HOTSPOT_MIN_SAMPLES:
                continue
            records.append(_cluster_record(group.iloc[members]))
        noise_total += int(len(group) - covered.sum())

    hotspots = pd.DataFrame.from_records(records)
    if not hotspots.empty:
        hotspots = hotspots.sort_values(
            ["uf", "br", "score", "n_acidentes"],
            ascending=[True, True, False, False],
        ).reset_index(drop=True)
    logger.info(
        "Clusterização: %d grupos (UF/BR), %d hotspots, %d acidentes descartados como ruído",
        groups,
        len(hotspots),
        noise_total,
    )
    return hotspots
