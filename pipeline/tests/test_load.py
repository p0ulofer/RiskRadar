from __future__ import annotations

import pandas as pd

from riskradar_pipeline.load import consolidate_by_accident, normalize_column, normalize_columns


def test_normalize_column_removes_accents_and_spaces():
    assert normalize_column("Latitude") == "latitude"
    assert normalize_column("  Causa Acidente ") == "causa_acidente"
    assert normalize_column("Classificação_Acidente") == "classificacao_acidente"
    assert normalize_column("\ufeffID") == "id"
    assert normalize_column("Rodovia") == "br"


def test_normalize_columns_handles_duplicates():
    frame = pd.DataFrame(columns=["ID", "id", "Latitude"])
    normalized = normalize_columns(frame)
    assert normalized.columns.tolist() == ["id", "id_1", "latitude"]


def test_consolidate_keeps_first_when_victims_repeat():
    frame = pd.DataFrame(
        {
            "ano": [2024, 2024, 2024],
            "id": ["1", "1", "2"],
            "mortos": ["1", "1", "0"],
            "feridos_leves": ["2", "2", "0"],
            "feridos_graves": ["0", "0", "0"],
            "ilesos": ["1", "1", "0"],
            "causa_acidente": ["A", "B", "C"],
        }
    )
    consolidated, stats = consolidate_by_accident(frame)
    assert len(consolidated) == 2
    assert stats["vitimas"] == "usar_primeiro_valor_por_id"
    row = consolidated.loc[consolidated["id"] == "1"].iloc[0]
    assert row["mortos"] == 1
    assert row["feridos_leves"] == 2


def test_consolidate_sums_when_victims_vary():
    frame = pd.DataFrame(
        {
            "ano": [2024, 2024],
            "id": ["9", "9"],
            "mortos": ["0", "2"],
            "feridos_leves": ["1", "3"],
            "feridos_graves": ["0", "1"],
            "ilesos": ["0", "0"],
            "causa_acidente": ["A", "B"],
        }
    )
    consolidated, stats = consolidate_by_accident(frame)
    assert stats["vitimas"] == "somar_por_id"
    row = consolidated.iloc[0]
    assert row["mortos"] == 2
    assert row["feridos_leves"] == 4
    assert row["feridos_graves"] == 1


def test_consolidate_is_noop_for_occurrence_level_file():
    frame = pd.DataFrame(
        {
            "ano": [2024, 2024],
            "id": ["1", "2"],
            "mortos": ["0", "1"],
            "feridos_leves": ["0", "0"],
            "feridos_graves": ["1", "0"],
            "ilesos": ["0", "0"],
        }
    )
    consolidated, stats = consolidate_by_accident(frame)
    assert len(consolidated) == 2
    assert stats["vitimas"] == "arquivo_ja_agrupado_por_ocorrencia"
