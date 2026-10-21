from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest
import requests

from riskradar_pipeline.export import build_document, validate_document
from riskradar_pipeline.osm import (
    OverpassClient,
    build_query,
    count_infra,
    enrich_hotspots,
    infra_totals,
    parse_elements,
)


def _hotspot(lat: float, lng: float, radius_m: int = 300) -> dict:
    return {"lat": lat, "lng": lng, "radius_m": radius_m}


def _elements() -> list[dict]:
    return [
        {
            "type": "node",
            "id": 1,
            "lat": -8.05,
            "lon": -34.90,
            "tags": {"highway": "traffic_signals"},
        },
        {
            "type": "node",
            "id": 2,
            "lat": -8.05,
            "lon": -34.90,
            "tags": {"highway": "crossing"},
        },
        {
            "type": "way",
            "id": 3,
            "center": {"lat": -8.0502, "lon": -34.9002},
            "tags": {"traffic_calming": "table"},
        },
        {
            "type": "node",
            "id": 4,
            "lat": -8.06,
            "lon": -34.92,
            "tags": {"highway": "speed_camera"},
        },
        {
            "type": "node",
            "id": 5,
            "lat": -8.05,
            "lon": -34.90,
            "tags": {"highway": "residential"},
        },
        {
            "type": "node",
            "id": 6,
            "lat": -8.05,
            "lon": -34.90,
            "tags": {"traffic_calming": "no"},
        },
    ]


def test_build_query_uses_radius_plus_padding():
    query = build_query([_hotspot(-8.05, -34.9, 300), _hotspot(-8.28, -35.97, 500)])
    assert query.startswith("[out:json]")
    assert 'nwr(around:400,-8.050000,-34.900000)["highway"~"^(traffic_signals|crossing|speed_camera)$"]' in query
    assert 'nwr(around:600,-8.280000,-35.970000)["traffic_calming"]' in query
    assert query.count("nwr(") == 4
    assert query.endswith("out center tags;")


def test_parse_elements_deduplicates_and_ignores_irrelevant_tags():
    parsed = parse_elements(_elements() + [_elements()[0]])
    assert len(parsed) == 4
    kinds = {kind for _, _, kind in parsed}
    assert kinds == {"traffic_signals", "crossing", "traffic_calming", "speed_camera"}


def test_count_infra_respects_hotspot_radius():
    counts = count_infra(_elements(), [_hotspot(-8.05, -34.90, 300)])
    assert counts[0] == {
        "traffic_signals": 1,
        "crossing": 1,
        "traffic_calming": 1,
        "speed_camera": 0,
    }


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class _FakeSession:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code
        self.queries: list[str] = []

    def post(self, url: str, **kwargs) -> _FakeResponse:
        self.queries.append(kwargs["data"]["data"])
        return _FakeResponse(self.payload, self.status_code)


class _FailingSession:
    def __init__(self) -> None:
        self.calls = 0

    def post(self, url: str, **kwargs):
        self.calls += 1
        raise requests.ConnectionError("sem rede")


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"lat": -8.05, "lng": -34.90, "radius_m": 300},
            {"lat": -8.28, "lng": -35.97, "radius_m": 400},
        ]
    )


def test_enrich_hotspots_uses_cache_between_runs(tmp_path: Path):
    session = _FakeSession({"elements": _elements()})
    client = OverpassClient(
        cache_dir=tmp_path,
        pause_s=0,
        session=session,
        sleep=lambda _: None,
    )

    enriched = enrich_hotspots(_frame(), client=client, batch_size=2)
    assert len(session.queries) == 1
    assert enriched.loc[0, "infra"]["traffic_signals"] == 1
    assert enriched.loc[0, "infra"]["speed_camera"] == 0
    assert enriched.loc[1, "infra"] == {
        "traffic_signals": 0,
        "crossing": 0,
        "traffic_calming": 0,
        "speed_camera": 0,
    }
    assert infra_totals(enriched)["traffic_signals"] == 1

    second_session = _FakeSession({"elements": []})
    second_client = OverpassClient(
        cache_dir=tmp_path,
        pause_s=0,
        session=second_session,
        sleep=lambda _: None,
    )
    enrich_hotspots(_frame(), client=second_client, batch_size=2)
    assert second_session.queries == []


def test_enrich_hotspots_retries_and_raises_after_failures(tmp_path: Path):
    session = _FailingSession()
    client = OverpassClient(
        cache_dir=tmp_path,
        pause_s=0,
        retries=1,
        session=session,
        sleep=lambda _: None,
    )
    with pytest.raises(RuntimeError):
        enrich_hotspots(
            _frame(),
            client=client,
            batch_size=1,
            max_consecutive_failures=1,
        )
    assert session.calls == 2


def test_enrich_hotspots_requires_coordinates():
    with pytest.raises(ValueError):
        enrich_hotspots(pd.DataFrame([{"lat": -8.0, "lng": -34.0}]))


def test_document_with_infra_uses_schema_2():
    frame = pd.DataFrame(
        [
            {
                "uf": "PE",
                "br": 101,
                "lat": -8.05,
                "lng": -34.9,
                "radius_m": 300,
                "municipio": "Recife",
                "km_min": 10.0,
                "km_max": 12.0,
                "km_mediana": 11.0,
                "n_acidentes": 5,
                "mortos": 0,
                "feridos_graves": 1,
                "feridos_leves": 2,
                "ilesos": 2,
                "score": 20,
                "level": "alto",
                "top_causas": [{"nome": "Falta de atenção", "n": 5}],
                "top_tipos": [{"nome": "Colisão traseira", "n": 5}],
                "fase_dia": {"Pleno Dia": 5},
                "por_ano": {"2024": 5},
                "infra": {
                    "traffic_signals": 1,
                    "crossing": 2,
                    "traffic_calming": 0,
                    "speed_camera": 0,
                },
            }
        ]
    )
    document = build_document(
        frame,
        cuts={"medio": 10.0, "alto": 20.0, "critico": 30.0},
        ufs=["PE"],
        years=[2024],
        total_accidents=5,
        schema_version=2,
    )
    validate_document(document)
    assert document["meta"]["schema_version"] == 2
    assert document["hotspots"][0]["infra"]["crossing"] == 2


def test_cache_is_written_as_json(tmp_path: Path):
    query = "consulta de teste"
    client = OverpassClient(
        cache_dir=tmp_path,
        pause_s=0,
        session=_FakeSession({"elements": _elements()}),
        sleep=lambda _: None,
    )
    client.fetch(query)
    files = list(tmp_path.glob("*.json"))
    assert len(files) == 1
    assert json.loads(files[0].read_text(encoding="utf-8"))["elements"]
