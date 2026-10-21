"""Exportação do ``hotspots.json`` e ``meta.json`` com validação de schema."""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import config

logger = logging.getLogger(__name__)

HOTSPOT_SCHEMA = {
    "type": "object",
    "required": [
        "id",
        "lat",
        "lng",
        "radius_m",
        "br",
        "uf",
        "municipio",
        "km_min",
        "km_max",
        "km_mediana",
        "n_acidentes",
        "mortos",
        "feridos_graves",
        "feridos_leves",
        "ilesos",
        "score",
        "level",
        "top_causas",
        "top_tipos",
        "fase_dia",
        "por_ano",
    ],
    "properties": {
        "id": {"type": "string", "pattern": r"^[A-Z]{2}-\d{1,4}-\d{4}$"},
        "lat": {"type": "number", "minimum": -34, "maximum": 6},
        "lng": {"type": "number", "minimum": -75, "maximum": -33},
        "radius_m": {"type": "integer", "minimum": 100, "maximum": 500},
        "br": {"type": "integer", "minimum": 1},
        "uf": {"type": "string", "minLength": 2, "maxLength": 2},
        "municipio": {"type": "string"},
        "km_min": {"type": "number", "minimum": 0},
        "km_max": {"type": "number", "minimum": 0},
        "km_mediana": {"type": "number", "minimum": 0},
        "n_acidentes": {"type": "integer", "minimum": 1},
        "mortos": {"type": "integer", "minimum": 0},
        "feridos_graves": {"type": "integer", "minimum": 0},
        "feridos_leves": {"type": "integer", "minimum": 0},
        "ilesos": {"type": "integer", "minimum": 0},
        "score": {"type": "integer", "minimum": 1},
        "level": {"enum": ["baixo", "medio", "alto", "critico"]},
        "top_causas": {
            "type": "array",
            "maxItems": 3,
            "items": {
                "type": "object",
                "required": ["nome", "n"],
                "properties": {
                    "nome": {"type": "string"},
                    "n": {"type": "integer", "minimum": 1},
                },
            },
        },
        "top_tipos": {"type": "array", "maxItems": 3, "items": {"type": "object"}},
        "fase_dia": {"type": "object", "additionalProperties": {"type": "integer"}},
        "por_ano": {
            "type": "object",
            "additionalProperties": {"type": "integer"},
            "propertyNames": {"pattern": r"^\d{4}$"},
        },
        "infra": {
            "type": "object",
            "properties": {
                "traffic_signals": {"type": "integer", "minimum": 0},
                "crossing": {"type": "integer", "minimum": 0},
                "traffic_calming": {"type": "integer", "minimum": 0},
                "speed_camera": {"type": "integer", "minimum": 0},
            },
        },
    },
}

DOCUMENT_SCHEMA = {
    "type": "object",
    "required": ["meta", "hotspots"],
    "properties": {
        "meta": {
            "type": "object",
            "required": [
                "schema_version",
                "generated_at",
                "data_version",
                "fonte",
                "ufs",
                "anos",
                "params",
                "cortes_nivel",
                "total_acidentes_considerados",
                "total_hotspots",
            ],
            "properties": {
                "schema_version": {"type": "integer", "minimum": 1},
                "generated_at": {"type": "string"},
                "data_version": {"type": "string", "pattern": r"^\d{8}-[0-9a-f]{8}$"},
                "fonte": {"enum": ["prf", "sintetico"]},
                "ufs": {"type": "array", "items": {"type": "string"}},
                "anos": {"type": "array", "items": {"type": "integer"}},
                "params": {"type": "object"},
                "cortes_nivel": {"type": "object"},
                "total_acidentes_considerados": {"type": "integer", "minimum": 0},
                "total_hotspots": {"type": "integer", "minimum": 0},
            },
        },
        "hotspots": {"type": "array", "items": HOTSPOT_SCHEMA},
    },
}


def validate_document(document: dict) -> None:
    """Valida o documento completo contra o schema; levanta ``ValueError`` se inválido."""
    try:
        import jsonschema
    except ImportError as exc:  # pragma: no cover - dependência declarada
        raise RuntimeError("jsonschema é obrigatório para validar a exportação") from exc
    try:
        jsonschema.validate(instance=document, schema=DOCUMENT_SCHEMA)
    except jsonschema.ValidationError as exc:
        raise ValueError(f"JSON de hotspots inválido: {exc.message}") from exc


def assign_ids(hotspots: pd.DataFrame) -> pd.DataFrame:
    """Gera ids estáveis ``UF-BR-NNNN`` ordenados por score dentro de cada par."""
    work = hotspots.copy()
    work = work.sort_values(
        ["uf", "br", "score", "n_acidentes", "lat"],
        ascending=[True, True, False, False, True],
    ).reset_index(drop=True)
    ranks = work.groupby(["uf", "br"], sort=False).cumcount() + 1
    work["id"] = [
        f"{uf}-{int(br)}-{rank:0{config.HOTSPOT_ID_DIGITS}d}"
        for uf, br, rank in zip(work["uf"], work["br"], ranks)
    ]
    return work


def _records(hotspots: pd.DataFrame) -> list[dict]:
    records: list[dict] = []
    for row in hotspots.to_dict("records"):
        record = {
            "id": row["id"],
            "lat": round(float(row["lat"]), config.COORD_DECIMALS),
            "lng": round(float(row["lng"]), config.COORD_DECIMALS),
            "radius_m": int(row["radius_m"]),
            "br": int(row["br"]),
            "uf": str(row["uf"]),
            "municipio": str(row["municipio"]),
            "km_min": float(row["km_min"]),
            "km_max": float(row["km_max"]),
            "km_mediana": float(row["km_mediana"]),
            "n_acidentes": int(row["n_acidentes"]),
            "mortos": int(row["mortos"]),
            "feridos_graves": int(row["feridos_graves"]),
            "feridos_leves": int(row["feridos_leves"]),
            "ilesos": int(row["ilesos"]),
            "score": int(row["score"]),
            "level": str(row["level"]),
            "top_causas": list(row["top_causas"]),
            "top_tipos": list(row["top_tipos"]),
            "fase_dia": {str(k): int(v) for k, v in row["fase_dia"].items()},
            "por_ano": {str(k): int(v) for k, v in row["por_ano"].items()},
        }
        if isinstance(row.get("infra"), dict):
            record["infra"] = {str(k): int(v) for k, v in row["infra"].items()}
        records.append(record)
    return records


def build_document(
    hotspots: pd.DataFrame,
    cuts: dict[str, float],
    ufs: list[str],
    years: list[int],
    total_accidents: int,
    fonte: str = "prf",
    schema_version: int = config.SCHEMA_VERSION,
    generated_at: datetime | None = None,
) -> dict:
    """Monta o documento final (com ids e metadados) e valida o schema."""
    if fonte not in {"prf", "sintetico"}:
        raise ValueError(f"Fonte inválida: {fonte}")
    if schema_version >= 2:
        # schema 2 admite o campo opcional 'infra'.
        pass
    hotspots_with_ids = assign_ids(hotspots)
    records = _records(hotspots_with_ids)

    payload_hash = hashlib.sha256(
        json.dumps(
            {"hotspots": records, "params": _params()},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:8]
    generated = generated_at or datetime.now(timezone.utc)
    if generated.tzinfo is None:
        generated = generated.replace(tzinfo=timezone.utc)

    meta = {
        "schema_version": int(schema_version),
        "generated_at": generated.isoformat().replace("+00:00", "Z"),
        "data_version": f"{generated.strftime('%Y%m%d')}-{payload_hash}",
        "fonte": fonte,
        "ufs": sorted({str(uf).upper() for uf in ufs}),
        "anos": [min(years), max(years)] if years else [],
        "params": _params(),
        "cortes_nivel": {
            "medio": round(float(cuts.get("medio", 0.0)), 2),
            "alto": round(float(cuts.get("alto", 0.0)), 2),
            "critico": round(float(cuts.get("critico", 0.0)), 2),
        },
        "total_acidentes_considerados": int(total_accidents),
        "total_hotspots": len(records),
    }
    document = {"meta": meta, "hotspots": records}
    validate_document(document)
    return document


def _params() -> dict:
    return {
        "eps_m": int(config.DBSCAN_EPS_M),
        "min_samples": config.DBSCAN_MIN_SAMPLES,
        "pesos": dict(config.SEVERITY_WEIGHTS),
    }


def write_outputs(
    document: dict,
    out_dir: str | Path,
    copy_to_app: bool = False,
    app_data_dir: str | Path | None = None,
) -> dict:
    """Grava hotspots.json/meta.json e, opcionalmente, copia para o app."""
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    hotspots_payload = json.dumps(
        document, ensure_ascii=False, separators=(",", ":")
    )
    meta_payload = json.dumps(
        document["meta"], ensure_ascii=False, separators=(",", ":")
    )

    hotspots_file = out_path / "hotspots.json"
    meta_file = out_path / "meta.json"
    hotspots_file.write_text(hotspots_payload, encoding="utf-8")
    meta_file.write_text(meta_payload, encoding="utf-8")

    size = hotspots_file.stat().st_size
    if size > config.MAX_JSON_BYTES_WARN:
        logger.warning(
            "hotspots.json tem %.1f MB (meta: ~5 MB para o Nordeste)", size / 1_048_576
        )

    copied: list[str] = []
    if copy_to_app:
        target_dir = (
            Path(app_data_dir)
            if app_data_dir
            else Path(__file__).resolve().parents[2] / "app" / "assets" / "data"
        )
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(hotspots_file, target_dir / "hotspots.json")
        shutil.copy2(meta_file, target_dir / "meta.json")
        copied = [str(target_dir / "hotspots.json"), str(target_dir / "meta.json")]

    logger.info(
        "Exportado: %s (%d hotspots, %.2f MB)", hotspots_file, len(document["hotspots"]), size / 1_048_576
    )
    return {
        "hotspots_file": str(hotspots_file),
        "meta_file": str(meta_file),
        "size_bytes": size,
        "copied": copied,
    }
