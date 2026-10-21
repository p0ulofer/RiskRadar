from __future__ import annotations

from riskradar_pipeline import config
from riskradar_pipeline.clean import clean
from riskradar_pipeline.score import add_severity_points
from riskradar_pipeline.cluster import cluster_hotspots
from riskradar_pipeline.synthetic import generate_dataframe


def test_synthetic_has_prf_schema_and_valid_coordinates():
    frame = generate_dataframe(n_accidents=500, years=[2024], seed=7)
    assert list(frame.columns) == config.RAW_COLUMNS
    assert len(frame) == 500
    cleaned, stats = clean(frame, ufs=config.DEFAULT_UFS, years=[2024])
    assert len(cleaned) == 500
    assert stats["descartes"]["sem_coordenadas"] == 0
    assert cleaned["latitude"].between(-34, 6).all()
    assert cleaned["longitude"].between(-75, -33).all()


def test_synthetic_generates_hotspots_with_enough_points():
    frame = generate_dataframe(n_accidents=3000, years=[2024], seed=11)
    cleaned, _ = clean(frame, ufs=config.DEFAULT_UFS, years=[2024])
    hotspots = cluster_hotspots(add_severity_points(cleaned))
    assert not hotspots.empty
    assert (hotspots["score"] > 0).all()
    assert (hotspots["n_acidentes"] >= config.DBSCAN_MIN_SAMPLES).all()
