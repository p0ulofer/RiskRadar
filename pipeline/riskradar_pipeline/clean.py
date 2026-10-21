"""Limpeza e normalização dos registros de acidentes."""

from __future__ import annotations

import logging
from collections import Counter
from typing import Iterable

import numpy as np
import pandas as pd

from . import config

logger = logging.getLogger(__name__)

TEXT_COLUMNS = [
    "dia_semana",
    "horario",
    "municipio",
    "causa_acidente",
    "tipo_acidente",
    "classificacao_acidente",
    "fase_dia",
    "sentido_via",
    "condicao_metereologica",
    "tipo_pista",
    "tracado_via",
    "uso_solo",
    "regional",
    "delegacia",
    "uop",
]


def parse_number(series: pd.Series) -> pd.Series:
    """Converte texto numérico brasileiro (vírgula decimal) para float.

    Aceita também valores com ponto decimal e remove separadores de milhar
    quando ambos os separadores aparecem (ex.: ``1.234,5``).
    """
    text = series.astype(str).str.strip()
    text = text.replace({"": None, "nan": None, "NaN": None, "NA": None, "None": None})
    has_comma = text.str.contains(",", regex=False, na=False)
    has_dot = text.str.contains(r"\.", regex=True, na=False)
    # 1.234,5 -> remove pontos de milhar e troca vírgula por ponto.
    both = has_comma & has_dot
    text = text.where(~both, text.str.replace(".", "", regex=False))
    text = text.str.replace(",", ".", regex=False)
    # Remove sufixos comuns (ex.: "km 415").
    text = text.str.replace(r"[^0-9eE+\-.]", "", regex=True)
    return pd.to_numeric(text, errors="coerce")


def clean_text(series: pd.Series) -> pd.Series:
    """Remove espaços extras e normaliza espaços internos."""
    cleaned = series.astype(str).str.replace(r"\s+", " ", regex=True).str.strip()
    return cleaned.replace({"nan": "", "None": "", "NA": ""})


def title_pt(text: str) -> str:
    """Capitaliza nomes em português mantendo conectores minúsculos."""
    small_words = {"de", "da", "do", "das", "dos", "e"}
    words = str(text).lower().split(" ")
    result = []
    for index, word in enumerate(words):
        if not word:
            continue
        result.append(word if index > 0 and word in small_words else word.capitalize())
    return " ".join(result)


def clean(
    df: pd.DataFrame,
    ufs: Iterable[str] | None = None,
    years: Iterable[int] | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Valida coordenadas, filtra UF/ano e normaliza tipos e textos.

    Retorna o DataFrame limpo e um dicionário com contagens de descarte.
    """
    work = df.copy()
    entrada = len(work)
    descartes: Counter[str] = Counter()
    total_por_motivo: dict[str, int] = {}

    if "id" not in work.columns:
        raise ValueError("Coluna obrigatória 'id' não encontrada nos arquivos de entrada.")
    if "ano" not in work.columns:
        if "data_inversa" in work.columns:
            work["ano"] = pd.to_datetime(
                work["data_inversa"].astype(str).str.strip(),
                format="%Y-%m-%d",
                errors="coerce",
            ).dt.year
        else:
            raise ValueError("Não foi possível determinar o ano dos acidentes.")

    for column in ["latitude", "longitude", "br", "km"] + config.VICTIM_COLUMNS:
        if column not in work.columns:
            work[column] = np.nan
    for column in TEXT_COLUMNS:
        if column not in work.columns:
            work[column] = ""

    lat = parse_number(work["latitude"])
    lng = parse_number(work["longitude"])
    work["latitude"] = lat
    work["longitude"] = lng

    missing_coords = lat.isna() | lng.isna()
    total_por_motivo["sem_coordenadas"] = int(missing_coords.sum())
    work = work.loc[~missing_coords]
    lat, lng = work["latitude"], work["longitude"]

    zero_coords = (lat == 0) & (lng == 0)
    total_por_motivo["coordenadas_zero"] = int(zero_coords.sum())
    work = work.loc[~zero_coords]
    lat, lng = work["latitude"], work["longitude"]

    bounds = config.BRAZIL_BOUNDS
    outside = (
        (lat < bounds["lat_min"])
        | (lat > bounds["lat_max"])
        | (lng < bounds["lng_min"])
        | (lng > bounds["lng_max"])
    )
    total_por_motivo["fora_do_brasil"] = int(outside.sum())
    work = work.loc[~outside]

    work["uf"] = work["uf"].astype(str).str.strip().str.upper()
    if ufs:
        requested_ufs = {str(uf).strip().upper() for uf in ufs}
        not_requested = ~work["uf"].isin(requested_ufs)
        total_por_motivo["uf_nao_solicitada"] = int(not_requested.sum())
        work = work.loc[~not_requested]

    work["ano"] = pd.to_numeric(work["ano"], errors="coerce")
    if years:
        requested_years = {int(year) for year in years}
        not_requested_year = ~work["ano"].isin(requested_years)
        total_por_motivo["ano_nao_solicitado"] = int(not_requested_year.sum())
        work = work.loc[~not_requested_year]
    work = work.loc[work["ano"].notna()].copy()

    work["id"] = work["id"].astype(str).str.strip()
    invalid_id = (work["id"] == "") | work["id"].str.lower().isin({"nan", "none"})
    total_por_motivo["id_invalido"] = int(invalid_id.sum())
    work = work.loc[~invalid_id]

    br = parse_number(work["br"])
    invalid_br = br.isna() | (br <= 0) | (br > 9999)
    total_por_motivo["br_invalido"] = int(invalid_br.sum())
    work = work.loc[~invalid_br].copy()
    work["br"] = br.loc[~invalid_br].round().astype(int)

    work["km"] = parse_number(work["km"])

    for column in config.VICTIM_COLUMNS:
        work[column] = parse_number(work[column]).fillna(0).round().astype(int)
    for column in ["pessoas", "feridos", "ignorados", "veiculos"]:
        work[column] = parse_number(work[column]).fillna(0).round().astype(int)

    for column in TEXT_COLUMNS:
        work[column] = clean_text(work[column])

    # Capitalização consistente em textos categóricos.
    work["municipio"] = work["municipio"].map(title_pt)
    work["fase_dia"] = work["fase_dia"].str.title()
    work["uf"] = work["uf"].str.upper()
    work["classificacao_acidente"] = work["classificacao_acidente"].replace({"Na": np.nan})

    work["ano"] = work["ano"].astype(int)
    work["latitude"] = work["latitude"].astype(float)
    work["longitude"] = work["longitude"].astype(float)

    duplicates = work.duplicated(subset=["ano", "id"], keep="first")
    total_por_motivo["duplicado_ano_id"] = int(duplicates.sum())
    work = work.loc[~duplicates].copy()

    work = work.reset_index(drop=True)

    for reason, count in total_por_motivo.items():
        descartes[reason] = count
    stats = {
        "entrada": int(entrada),
        "descartes": dict(descartes),
        "total_descartado": int(entrada - len(work)),
        "saida": int(len(work)),
    }
    logger.info(
        "Limpeza: %d registros de entrada, %d descartados %s, %d mantidos",
        stats["entrada"],
        stats["total_descartado"],
        dict(descartes),
        stats["saida"],
    )
    return work, stats
