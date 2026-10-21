"""Clusterização geográfica dos acidentes com DBSCAN (haversine).

Cada par (UF, BR) é processado separadamente para nunca fundir rodovias
distintas. O ruído (label -1) é descartado.
"""

from __future__ import annotations

import logging
from collections import Counter

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN

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


def _cluster_record(group: pd.DataFrame) -> dict:
    lats = group["latitude"].to_numpy(dtype=float)
    lngs = group["longitude"].to_numpy(dtype=float)
    center_lat = float(lats.mean())
    center_lng = float(lngs.mean())
    distances = haversine_m(center_lat, center_lng, lats, lngs)
    radius = float(np.percentile(distances, config.RADIUS_PERCENTILE))
    radius = float(np.clip(radius, config.RADIUS_MIN_M, config.RADIUS_MAX_M))

    km = group["km"].dropna()
    km_min = float(km.min()) if not km.empty else 0.0
    km_max = float(km.max()) if not km.empty else 0.0

    return {
        "lat": center_lat,
        "lng": center_lng,
        "radius_m": int(round(radius)),
        "uf": str(group["uf"].iloc[0]),
        "br": int(group["br"].iloc[0]),
        "municipio": _mode(group["municipio"]),
        "km_min": round(km_min, 1),
        "km_max": round(km_max, 1),
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
        if len(group) < config.DBSCAN_MIN_SAMPLES:
            noise_total += len(group)
            continue

        coords = np.radians(group[["latitude", "longitude"]].to_numpy(dtype=float))
        model = DBSCAN(
            eps=config.DBSCAN_EPS_RAD,
            min_samples=config.DBSCAN_MIN_SAMPLES,
            metric="haversine",
            algorithm="ball_tree",
        )
        labels = model.fit_predict(coords)
        noise = int(np.sum(labels == -1))
        noise_total += noise

        for label in sorted(set(labels)):
            if label == -1:
                continue
            subset = group.loc[labels == label]
            records.append(_cluster_record(subset))

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
