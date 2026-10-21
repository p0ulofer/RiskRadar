from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from riskradar_pipeline.cluster import cluster_hotspots, haversine_m
from riskradar_pipeline.score import add_severity_points, assign_levels
from riskradar_pipeline.export import build_document, validate_document


def _accidents(br: int, center: tuple[float, float], count: int, uf: str = "PE"):
    rows = []
    for index in range(count):
        rows.append(
            {
                "id": f"{br}-{center[0]}-{index}",
                "ano": 2024,
                "uf": uf,
                "br": br,
                "latitude": center[0] + (index - count / 2) * 0.0003,
                "longitude": center[1] + (index - count / 2) * 0.0003,
                "km": 100 + index,
                "municipio": "Recife" if br == 101 else "Caruaru",
                "causa_acidente": "Falta de atenção",
                "tipo_acidente": "Colisão traseira",
                "classificacao_acidente": "Com Vítimas Feridas",
                "fase_dia": "Pleno Dia",
                "mortos": 0,
                "feridos_graves": 1,
                "feridos_leves": 2,
                "ilesos": 1,
                "pontos": 4,
            }
        )
    return rows


def test_haversine_distance_known_value():
    # Recife -> Olinda (~7 km em linha reta)
    distance = haversine_m(-8.0476, -34.8770, -7.9950, -34.8550)
    assert 5000 < float(distance) < 8000


def test_clusters_do_not_merge_different_roads():
    rows = _accidents(101, (-8.05, -34.90), 10) + _accidents(232, (-8.28, -35.97), 10)
    frame = pd.DataFrame(rows)
    hotspots = cluster_hotspots(frame)
    assert len(hotspots) == 2
    assert set(hotspots["br"].tolist()) == {101, 232}


def test_noise_points_are_discarded():
    rows = _accidents(101, (-8.05, -34.90), 10)
    rows.append(
        {
            **rows[0],
            "id": "noise",
            "latitude": -15.0,
            "longitude": -45.0,
        }
    )
    hotspots = cluster_hotspots(pd.DataFrame(rows))
    assert len(hotspots) == 1
    assert int(hotspots.iloc[0]["n_acidentes"]) == 10
    assert 100 <= int(hotspots.iloc[0]["radius_m"]) <= 500


def test_radius_is_clipped_and_score_is_summed():
    rows = _accidents(101, (-8.05, -34.90), 12)
    hotspots = cluster_hotspots(pd.DataFrame(rows))
    assert hotspots.iloc[0]["score"] == 48
    assert 100 <= int(hotspots.iloc[0]["radius_m"]) <= 500
    assert hotspots.iloc[0]["mortos"] == 0
    assert hotspots.iloc[0]["feridos_graves"] == 12


def test_export_builds_valid_document_with_stable_ids():
    rows = _accidents(101, (-8.05, -34.90), 10) + _accidents(232, (-8.28, -35.97), 10)
    frame = add_severity_points(pd.DataFrame(rows))
    hotspots, cuts = assign_levels(cluster_hotspots(frame))
    document = build_document(
        hotspots,
        cuts=cuts,
        ufs=["PE"],
        years=[2024],
        total_accidents=20,
        fonte="prf",
        generated_at=datetime(2026, 10, 21, tzinfo=timezone.utc),
    )
    validate_document(document)
    assert document["meta"]["total_hotspots"] == 2
    assert document["meta"]["data_version"].startswith("20261021-")
    ids = [hotspot["id"] for hotspot in document["hotspots"]]
    assert all(part.isdigit() and len(part) == 4 for part in (item.split("-")[2] for item in ids))
    assert all(item.startswith(("PE-101-", "PE-232-")) for item in ids)
    import json

    serialized = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
    assert "\n" not in serialized
