from __future__ import annotations

import pandas as pd

from riskradar_pipeline.clean import clean, parse_number, title_pt


def _frame(rows):
    base = {
        "id": "1",
        "ano": 2024,
        "uf": "PE",
        "br": "101",
        "km": "10,5",
        "municipio": "RECIFE",
        "causa_acidente": "Falta de atenção",
        "tipo_acidente": "Colisão traseira",
        "classificacao_acidente": "Com Vítimas Feridas",
        "fase_dia": "PLENO DIA",
        "latitude": "-8,05",
        "longitude": "-34,90",
        "mortos": "0",
        "feridos_leves": "1",
        "feridos_graves": "0",
        "ilesos": "2",
        "pessoas": "3",
        "feridos": "1",
        "ignorados": "0",
        "veiculos": "2",
    }
    return pd.DataFrame([{**base, **row} for row in rows])


def test_parse_number_accepts_brazilian_decimal():
    series = pd.Series(["1,5", "-8,0512", "10", "", "abc", "1.234,5"])
    parsed = parse_number(series)
    assert parsed.iloc[0] == 1.5
    assert parsed.iloc[1] == -8.0512
    assert parsed.iloc[2] == 10
    assert pd.isna(parsed.iloc[3])
    assert pd.isna(parsed.iloc[4])
    assert parsed.iloc[5] == 1234.5


def test_clean_drops_invalid_coordinates_and_filters():
    frame = _frame(
        [
            {},
            {"id": "2", "latitude": "0", "longitude": "0"},
            {"id": "3", "latitude": "40,0"},
            {"id": "4", "uf": "SP"},
            {"id": "5", "ano": 2021},
            {"id": "6", "br": "0"},
        ]
    )
    cleaned, stats = clean(frame, ufs=["PE"], years=[2024])
    assert cleaned["id"].tolist() == ["1"]
    assert stats["descartes"]["coordenadas_zero"] == 1
    assert stats["descartes"]["fora_do_brasil"] == 1
    assert stats["descartes"]["uf_nao_solicitada"] == 1
    assert stats["descartes"]["ano_nao_solicitado"] == 1
    assert stats["descartes"]["br_invalido"] == 1


def test_clean_normalizes_text_and_numbers():
    frame = _frame([{"km": "415,5", "municipio": "  SAO   JOSE  "}])
    cleaned, _ = clean(frame, ufs=["PE"], years=[2024])
    row = cleaned.iloc[0]
    assert row["km"] == 415.5
    assert row["latitude"] == -8.05
    assert row["municipio"] == "Sao Jose"
    assert row["fase_dia"] == "Pleno Dia"
    assert row["br"] == 101
    assert row["mortos"] == 0
    assert row["feridos_leves"] == 1


def test_title_pt_keeps_connectors_lowercase():
    assert title_pt("SAO MIGUEL DOS CAMPOS") == "Sao Miguel dos Campos"
    assert title_pt("JEQUIA DA PRAIA") == "Jequia da Praia"
    assert title_pt("RECIFE") == "Recife"
