from __future__ import annotations

import numpy as np
import pandas as pd

from riskradar_pipeline.score import (
    add_severity_points,
    assign_levels,
    compute_level_cuts,
    level_for_score,
    severity_points,
)


def test_severity_points_follow_classification():
    assert severity_points({"classificacao_acidente": "Sem Vítimas"}) == 1
    assert severity_points({"classificacao_acidente": "Com Vítimas Feridas"}) == 4
    assert severity_points({"classificacao_acidente": "Com Vítimas Fatais"}) == 13


def test_severity_points_fall_back_to_counts():
    assert severity_points({"classificacao_acidente": "", "mortos": 2}) == 13
    assert severity_points({"classificacao_acidente": "NA", "mortos": 0, "feridos_graves": 1}) == 4
    assert severity_points({"classificacao_acidente": None, "mortos": 0}) == 1


def test_add_severity_points_column():
    frame = pd.DataFrame(
        {
            "classificacao_acidente": ["Sem Vítimas", "Com Vítimas Feridas", "Com Vítimas Fatais"],
            "mortos": [0, 0, 1],
            "feridos_graves": [0, 1, 0],
            "feridos_leves": [0, 0, 0],
        }
    )
    scored = add_severity_points(frame)
    assert scored["pontos"].tolist() == [1, 4, 13]
    assert scored["pontos"].sum() == 18


def test_level_cuts_and_levels():
    scores = pd.Series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    cuts = compute_level_cuts(scores)
    assert cuts["medio"] == np.percentile(scores, 50)
    assert cuts["alto"] == np.percentile(scores, 80)
    assert cuts["critico"] == np.percentile(scores, 95)
    assert level_for_score(10, cuts) == "critico"
    assert level_for_score(9, cuts) == "alto"
    assert level_for_score(8, cuts) == "medio"
    assert level_for_score(5, cuts) == "baixo"
    assert level_for_score(1, cuts) == "baixo"


def test_assign_levels_adds_column():
    frame = pd.DataFrame({"score": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]})
    result, cuts = assign_levels(frame)
    assert result["level"].tolist() == [
        "baixo",
        "baixo",
        "baixo",
        "baixo",
        "baixo",
        "medio",
        "medio",
        "medio",
        "alto",
        "critico",
    ]
    assert cuts["critico"] > cuts["alto"] > cuts["medio"]


def test_empty_scores_have_zero_cuts():
    assert compute_level_cuts([]) == {"medio": 0.0, "alto": 0.0, "critico": 0.0}
