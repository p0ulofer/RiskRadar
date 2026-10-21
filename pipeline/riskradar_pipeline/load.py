"""Carga dos CSVs abertos da PRF.

Responsabilidades:
- localizar arquivos .csv/.zip em ``data/raw``;
- detectar encoding e delimitador;
- normalizar nomes de colunas (minúsculas, sem acento, snake_case);
- acrescentar o ano a partir de ``data_inversa`` (ou do nome do arquivo);
- consolidar arquivos com múltiplas linhas por acidente, quando for o caso.

A inspeção dos arquivos reais de 2022–2026 mostrou que eles já são
"agrupados por ocorrência" (um registro por ``id``). Ainda assim a consolidação
é implementada e testada, pois o portal também publica arquivos
"todas_causas_tipos" com várias linhas por acidente.
"""

from __future__ import annotations

import csv
import logging
import re
import tempfile
import unicodedata
import zipfile
from pathlib import Path
from typing import Iterable

import pandas as pd

from . import config

logger = logging.getLogger(__name__)

VICTIM_COLUMNS = config.VICTIM_COLUMNS
NUMERIC_COLUMNS = VICTIM_COLUMNS + ["pessoas", "feridos", "ignorados", "veiculos"]


def normalize_column(name: str) -> str:
    """Normaliza um nome de coluna: sem BOM/aspas/acentos, minúsculo, snake_case."""
    text = str(name).replace("\ufeff", "").strip().strip('"').strip("'")
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return config.COLUMN_ALIASES.get(text, text)


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Renomeia colunas normalizadas, mantendo a primeira ocorrência em duplicatas."""
    seen: dict[str, int] = {}
    new_columns: list[str] = []
    for column in df.columns:
        normalized = normalize_column(column)
        if normalized in seen:
            seen[normalized] += 1
            normalized = f"{normalized}_{seen[normalized]}"
        else:
            seen[normalized] = 0
        new_columns.append(normalized)
    df = df.copy()
    df.columns = new_columns
    return df


def detect_encoding(path: Path, sample_size: int = 65536) -> str:
    """Detecta latin-1/utf-8 lendo uma amostra do arquivo."""
    sample = path.read_bytes()[:sample_size]
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            sample.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    return "latin-1"


def detect_delimiter(path: Path, encoding: str, sample_size: int = 65536) -> str:
    """Detecta ``;`` ou ``,`` a partir da primeira linha útil."""
    with path.open("r", encoding=encoding, errors="replace") as handle:
        first_line = handle.readline()
    try:
        dialect = csv.Sniffer().sniff(first_line, delimiters=";,\t|")
        if dialect.delimiter in {";", ",", "\t", "|"}:
            # Sniffer pode se confundir com vírgula decimal; prioriza ';' se
            # houver mais ';' que vírgulas na linha de cabeçalho.
            if first_line.count(";") >= first_line.count(","):
                return ";"
            return dialect.delimiter
    except csv.Error:
        pass
    return ";" if first_line.count(";") >= first_line.count(",") else ","


def _read_dataframe(path: Path) -> pd.DataFrame:
    encoding = detect_encoding(path)
    delimiter = detect_delimiter(path, encoding)
    logger.info("Lendo %s (encoding=%s, delimitador=%r)", path.name, encoding, delimiter)
    df = pd.read_csv(
        path,
        sep=delimiter,
        encoding=encoding,
        dtype=str,
        keep_default_na=False,
        na_values=[],
        engine="python",
        on_bad_lines="warn",
    )
    return normalize_columns(df)


def _extract_zip_members(entry: Path) -> list[Path]:
    """Extrai os CSVs de um ZIP para um cache em disco e devolve os caminhos."""
    temp_dir = Path(tempfile.gettempdir()) / "riskradar_csv_cache"
    temp_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[Path] = []
    with zipfile.ZipFile(entry) as archive:
        for member in archive.infolist():
            if member.is_dir() or not member.filename.lower().endswith(".csv"):
                continue
            target = temp_dir / f"{entry.stem}_{Path(member.filename).name}"
            if not target.exists() or target.stat().st_size != member.file_size:
                target.write_bytes(archive.read(member))
            extracted.append(target)
    return extracted


def _iter_source_files(raw_dir: Path) -> Iterable[tuple[Path, str]]:
    """Itera arquivos CSV, extraindo ZIPs para um cache temporário em disco.

    Quando existir ``X.csv`` e ``X.zip`` no mesmo diretório, o CSV é
    preferido para não carregar o mesmo ano duas vezes.
    """
    entries = [entry for entry in sorted(raw_dir.iterdir()) if entry.is_file()]
    csv_stems = {entry.stem.lower() for entry in entries if entry.suffix.lower() == ".csv"}
    for entry in entries:
        if entry.suffix.lower() == ".csv":
            yield entry, entry.stem
        elif entry.suffix.lower() == ".zip":
            if entry.stem.lower() in csv_stems:
                logger.info("Ignorando %s (já existe CSV equivalente extraído)", entry.name)
                continue
            for extracted in _extract_zip_members(entry):
                yield extracted, f"{entry.stem}_{extracted.stem}"


def _year_from_filename(name: str) -> int | None:
    match = re.search(r"(19|20)\d{2}", name)
    if match:
        return int(match.group(0))
    return None


def add_year_column(df: pd.DataFrame, fallback_name: str) -> pd.DataFrame:
    df = df.copy()
    if "ano" in df.columns:
        df["ano"] = pd.to_numeric(df["ano"], errors="coerce")
    else:
        df["ano"] = pd.NA
    if "data_inversa" in df.columns:
        parsed = pd.to_datetime(
            df["data_inversa"].astype(str).str.strip(),
            format="%Y-%m-%d",
            errors="coerce",
        )
        df["ano"] = df["ano"].fillna(parsed.dt.year)
    fallback = _year_from_filename(fallback_name)
    if fallback is not None:
        df["ano"] = df["ano"].fillna(fallback)
    df["ano"] = pd.to_numeric(df["ano"], errors="coerce")
    return df


def consolidate_by_accident(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Consolida múltiplas linhas por acidente.

    Detecta empiricamente se as colunas de vítimas se repetem iguais entre as
    linhas do mesmo ``(ano, id)`` (usa o primeiro valor) ou variam (soma).
    Preserva a primeira causa/tipo e registra a decisão no dicionário retornado.
    """
    if df.empty:
        return df, {"linhas_antes": 0, "linhas_depois": 0, "vitimas": "nao_aplicavel"}

    key = ["ano", "id"]
    duplicated_groups = df.duplicated(subset=key, keep=False).sum()
    if duplicated_groups == 0:
        stats = {
            "linhas_antes": len(df),
            "linhas_depois": len(df),
            "linhas_duplicadas": 0,
            "vitimas": "arquivo_ja_agrupado_por_ocorrencia",
        }
        return df, stats

    victims_mode = "primeiro"
    for column in VICTIM_COLUMNS:
        if column not in df.columns:
            continue
        numeric = pd.to_numeric(
            df[column].astype(str).str.replace(",", ".", regex=False),
            errors="coerce",
        ).fillna(0)
        temp = df.assign(**{column: numeric})
        varying = temp.groupby(key, dropna=False)[column].nunique(dropna=False).max()
        if varying and varying > 1:
            victims_mode = "soma"
            break

    aggregations: dict[str, str] = {}
    for column in df.columns:
        if column in key:
            continue
        if column in VICTIM_COLUMNS and victims_mode == "soma":
            aggregations[column] = "sum"
        else:
            aggregations[column] = "first"

    numeric_work = df.copy()
    for column in VICTIM_COLUMNS:
        if column in numeric_work.columns:
            numeric_work[column] = pd.to_numeric(
                numeric_work[column].astype(str).str.replace(",", ".", regex=False),
                errors="coerce",
            ).fillna(0)

    consolidated = numeric_work.groupby(key, dropna=False, as_index=False).agg(aggregations)
    stats = {
        "linhas_antes": len(df),
        "linhas_depois": len(consolidated),
        "linhas_duplicadas": int(duplicated_groups),
        "vitimas": f"usar_{victims_mode}_valor_por_id" if victims_mode == "primeiro" else "somar_por_id",
    }
    return consolidated, stats


def load_raw(
    raw_dir: str | Path,
    years: Iterable[int] | None = None,
    ufs: Iterable[str] | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Carrega todos os CSVs/ZIPs de ``raw_dir`` e devolve o DataFrame consolidado."""
    raw_path = Path(raw_dir)
    if not raw_path.exists():
        raise FileNotFoundError(f"Diretório de dados brutos não encontrado: {raw_path}")

    frames: list[pd.DataFrame] = []
    sources: list[str] = []
    for path, fallback_name in _iter_source_files(raw_path):
        try:
            frame = _read_dataframe(path)
        except Exception as exc:  # noqa: BLE001 - queremos seguir com os demais arquivos
            logger.warning("Ignorando %s: %s", path, exc)
            continue
        if frame.empty:
            continue
        frame = add_year_column(frame, fallback_name)
        frame["_source_file"] = f"{fallback_name}"
        frames.append(frame)
        sources.append(str(path))

    if not frames:
        raise FileNotFoundError(
            f"Nenhum CSV válido encontrado em {raw_path}. "
            "Coloque os arquivos datatranAAAA.csv (ou .zip) na pasta."
        )

    df = pd.concat(frames, ignore_index=True, sort=False)
    logger.info("Carregados %d registros de %d arquivo(s)", len(df), len(frames))

    stats = {
        "arquivos": sources,
        "linhas_carregadas": int(len(df)),
        "colunas_detectadas": sorted(df.columns.tolist()),
    }

    df, consolidation = consolidate_by_accident(df)
    stats["consolidacao"] = consolidation
    logger.info("Consolidação por acidente: %s", consolidation)

    if years:
        years_list = [int(year) for year in years]
        stats["anos_solicitados"] = years_list
    if ufs:
        stats["ufs_solicitadas"] = [str(uf).upper() for uf in ufs]
    stats["anos_disponiveis"] = sorted(int(y) for y in df["ano"].dropna().unique())
    return df, stats
