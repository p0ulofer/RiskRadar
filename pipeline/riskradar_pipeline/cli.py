"""Interface de linha de comando do pipeline RiskRadar."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from . import cluster, config, export, load, osm, score, synthetic
from .clean import clean

logger = logging.getLogger("riskradar")


def _expand_years(years: list[int]) -> list[int]:
    """Interpreta ``--years 2022 2026`` como intervalo inclusivo."""
    if not years:
        return list(config.DEFAULT_YEARS)
    if len(years) == 2:
        start, end = sorted(int(year) for year in years)
        return list(range(start, end + 1))
    return sorted({int(year) for year in years})


def _build(args: argparse.Namespace) -> int:
    raw_dir = Path(args.raw)
    out_dir = Path(args.out)
    ufs = [uf.upper() for uf in args.ufs] if args.ufs else list(config.DEFAULT_UFS)
    years = _expand_years(args.years) if args.years else list(config.DEFAULT_YEARS)

    fonte = "prf"
    if args.synthetic:
        raw_dir.mkdir(parents=True, exist_ok=True)
        target = raw_dir / "datatran_sintetico.csv"
        synthetic.generate_csv(target, n_accidents=args.synthetic_rows, years=years)
        fonte = "sintetico"

    try:
        raw_df, load_stats = load.load_raw(raw_dir, years=years, ufs=ufs)
    except FileNotFoundError:
        logger.warning("Nenhum CSV encontrado em %s; usando fallback sintético.", raw_dir)
        raw_dir.mkdir(parents=True, exist_ok=True)
        target = raw_dir / "datatran_sintetico.csv"
        synthetic.generate_csv(target, n_accidents=args.synthetic_rows, years=years)
        raw_df, load_stats = load.load_raw(raw_dir, years=years, ufs=ufs)
        fonte = "sintetico"

    clean_df, clean_stats = clean(raw_df, ufs=ufs, years=years)
    if clean_df.empty:
        logger.error("Nenhum registro válido após a limpeza. Abortando.")
        return 1

    scored_df = score.add_severity_points(clean_df)
    hotspots = cluster.cluster_hotspots(scored_df)
    if hotspots.empty:
        logger.error("Nenhum hotspot gerado (min_samples=%d). Abortando.", config.DBSCAN_MIN_SAMPLES)
        return 1
    hotspots, cuts = score.assign_levels(hotspots)

    schema_version = config.SCHEMA_VERSION
    infra_totals = None
    if args.with_infra:
        client = osm.OverpassClient(
            endpoint=args.osm_endpoint,
            cache_dir=args.osm_cache_dir,
            pause_s=args.osm_pause,
            timeout_s=args.osm_timeout,
        )
        try:
            hotspots = osm.enrich_hotspots(
                hotspots,
                client=client,
                batch_size=args.osm_batch_size,
                padding_m=args.osm_padding,
            )
            schema_version = 2
            infra_totals = osm.infra_totals(hotspots)
        except Exception as exc:  # falha de rede não deve impedir a entrega do app
            logger.warning(
                "Enriquecimento OSM indisponível (%s); seguindo sem o campo infra.", exc
            )

    document = export.build_document(
        hotspots,
        cuts=cuts,
        ufs=ufs,
        years=years,
        total_accidents=len(clean_df),
        fonte=fonte,
        schema_version=schema_version,
    )
    outputs = export.write_outputs(
        document,
        out_dir,
        copy_to_app=args.copy_to_app,
        app_data_dir=args.app_data_dir,
    )

    summary = {
        "fonte": fonte,
        "anos": years,
        "ufs": ufs,
        "acidentes_carregados": load_stats["linhas_carregadas"],
        "acidentes_considerados": len(clean_df),
        "descartes": clean_stats["descartes"],
        "hotspots": len(document["hotspots"]),
        "json_mb": round(outputs["size_bytes"] / 1_048_576, 3),
        "niveis": {},
        "infra": infra_totals,
        "arquivos": outputs,
    }
    levels: dict[str, int] = {}
    for record in document["hotspots"]:
        levels[record["level"]] = levels.get(record["level"], 0) + 1
    summary["niveis"] = levels
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m riskradar_pipeline.cli",
        description="Pipeline de hotspots de acidentes em rodovias federais (PRF).",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="logs detalhados")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="gera hotspots.json e meta.json")
    build.add_argument("--raw", default="data/raw", help="diretório com CSVs/ZIPs da PRF")
    build.add_argument("--out", default="data/processed", help="diretório de saída")
    build.add_argument("--ufs", nargs="+", default=config.DEFAULT_UFS, help="UFs a considerar")
    build.add_argument("--years", nargs="+", type=int, default=config.DEFAULT_YEARS, help="anos a considerar")
    build.add_argument("--copy-to-app", action="store_true", help="copia JSONs para app/assets/data")
    build.add_argument("--app-data-dir", default=None, help="diretório alternativo de destino no app")
    build.add_argument("--synthetic", action="store_true", help="força o uso de dados sintéticos")
    build.add_argument("--synthetic-rows", type=int, default=30_000, help="acidentes sintéticos")
    build.add_argument(
        "--with-infra",
        action="store_true",
        help="enriquece os hotspots com infraestrutura do OpenStreetMap (schema 2)",
    )
    build.add_argument(
        "--osm-endpoint",
        default=config.OSM_OVERPASS_URL,
        help="endpoint da Overpass API",
    )
    build.add_argument(
        "--osm-cache-dir",
        default=config.OSM_CACHE_DIR,
        help="cache das respostas da Overpass API",
    )
    build.add_argument(
        "--osm-timeout",
        type=float,
        default=config.OSM_TIMEOUT_S,
        help="timeout de cada requisição, em segundos",
    )
    build.add_argument(
        "--osm-batch-size", type=int, default=config.OSM_BATCH_SIZE, help="hotspots por consulta"
    )
    build.add_argument(
        "--osm-pause",
        type=float,
        default=config.OSM_PAUSE_S,
        help="pausa mínima entre requisições, em segundos",
    )
    build.add_argument(
        "--osm-padding",
        type=int,
        default=config.OSM_RADIUS_PADDING_M,
        help="metros adicionados ao raio de cada hotspot na consulta",
    )

    synth = subparsers.add_parser("synthetic", help="gera apenas o CSV sintético")
    synth.add_argument("--out", default="data/raw/datatran_sintetico.csv")
    synth.add_argument("--rows", type=int, default=30_000)
    synth.add_argument("--years", nargs="+", type=int, default=config.DEFAULT_YEARS)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if args.command == "build":
        return _build(args)
    if args.command == "synthetic":
        target = synthetic.generate_csv(
            args.out, n_accidents=args.rows, years=args.years
        )
        print(target)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
