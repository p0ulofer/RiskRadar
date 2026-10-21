"""Cálculo de severidade, score e nível dos hotspots."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from . import config

logger = logging.getLogger(__name__)


def severity_points(row: pd.Series | dict) -> int:
    """Pontos de severidade de um acidente (aproximação da UPS da PRF)."""
    classification = str(row.get("classificacao_acidente") or "").strip().lower()
    deaths = row.get("mortos", 0) or 0
    injured = (row.get("feridos_graves", 0) or 0) + (row.get("feridos_leves", 0) or 0)

    if "fata" in classification:
        return int(config.SEVERITY_WEIGHTS["mortos"])
    if "ferid" in classification:
        return int(config.SEVERITY_WEIGHTS["feridos"])
    if "sem" in classification and "vitima" in classification:
        return int(config.SEVERITY_WEIGHTS["sem_vitimas"])

    # Classificação ausente/desconhecida: deriva dos números de vítimas.
    if deaths > 0:
        return int(config.SEVERITY_WEIGHTS["mortos"])
    if injured > 0:
        return int(config.SEVERITY_WEIGHTS["feridos"])
    return int(config.SEVERITY_WEIGHTS["sem_vitimas"])


def add_severity_points(df: pd.DataFrame) -> pd.DataFrame:
    """Adiciona a coluna ``pontos`` (peso de cada acidente)."""
    work = df.copy()
    work["pontos"] = [
        severity_points(row)
        for row in work[
            ["classificacao_acidente", "mortos", "feridos_graves", "feridos_leves"]
        ].to_dict("records")
    ]
    return work


def compute_level_cuts(scores: pd.Series | np.ndarray) -> dict[str, float]:
    """Calcula os cortes de nível por percentil do score entre os hotspots."""
    values = np.asarray(list(scores), dtype=float)
    values = values[~np.isnan(values)]
    if values.size == 0:
        return {"medio": 0.0, "alto": 0.0, "critico": 0.0}
    cuts = {
        name: float(np.percentile(values, percentile))
        for name, percentile in config.LEVEL_PERCENTILES.items()
    }
    return cuts


def level_for_score(score: float, cuts: dict[str, float]) -> str:
    """Mapeia um score para o nível, respeitando os cortes calculados."""
    if score >= cuts.get("critico", float("inf")):
        return "critico"
    if score >= cuts.get("alto", float("inf")):
        return "alto"
    if score >= cuts.get("medio", float("inf")):
        return "medio"
    return "baixo"


def assign_levels(hotspots: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, float]]:
    """Atribui ``level`` a cada hotspot e devolve os cortes usados."""
    work = hotspots.copy()
    if work.empty:
        work["level"] = pd.Series(dtype=str)
        return work, {"medio": 0.0, "alto": 0.0, "critico": 0.0}
    cuts = compute_level_cuts(work["score"])
    work["level"] = [level_for_score(float(score), cuts) for score in work["score"]]
    logger.info(
        "Níveis: %s (cortes p50=%.1f, p80=%.1f, p95=%.1f)",
        work["level"].value_counts().to_dict(),
        cuts["medio"],
        cuts["alto"],
        cuts["critico"],
    )
    return work, cuts
