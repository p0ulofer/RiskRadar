"""Gerador de dados sintéticos (fallback quando o download da PRF é impossível).

Gera um CSV com o mesmo schema dos arquivos ``datatran`` da PRF, no recorte do
Nordeste, com concentrações propositais de acidentes para formar hotspots.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from . import config

logger = logging.getLogger(__name__)

# Âncoras aproximadas das rodovias federais no Nordeste: (lat, lng, km).
ROUTE_ANCHORS: dict[int, list[tuple[float, float, float]]] = {
    101: [
        (-7.94, -34.87, 0.0),
        (-8.05, -34.90, 12.0),
        (-8.68, -35.10, 82.0),
        (-9.66, -35.72, 190.0),
        (-10.50, -36.40, 290.0),
        (-11.30, -37.10, 390.0),
        (-12.40, -38.20, 520.0),
        (-13.50, -39.10, 640.0),
        (-14.80, -39.30, 760.0),
        (-16.40, -39.50, 900.0),
        (-18.00, -39.80, 1050.0),
    ],
    116: [
        (-3.70, -38.60, 0.0),
        (-4.20, -38.90, 60.0),
        (-4.90, -39.40, 140.0),
        (-5.80, -39.70, 230.0),
        (-6.70, -40.20, 330.0),
        (-7.60, -40.60, 430.0),
        (-8.60, -40.90, 540.0),
        (-9.60, -41.10, 650.0),
        (-10.70, -42.00, 780.0),
        (-12.00, -42.50, 920.0),
        (-13.50, -42.90, 1080.0),
        (-15.00, -43.50, 1250.0),
    ],
    232: [
        (-7.95, -34.90, 0.0),
        (-8.20, -35.30, 40.0),
        (-8.10, -36.20, 140.0),
        (-7.95, -37.10, 240.0),
        (-7.80, -38.00, 340.0),
        (-7.65, -38.90, 440.0),
        (-7.50, -39.70, 540.0),
        (-7.40, -40.50, 640.0),
        (-7.30, -41.30, 740.0),
    ],
    316: [
        (-9.40, -38.20, 0.0),
        (-9.10, -39.20, 110.0),
        (-8.80, -40.20, 220.0),
        (-8.50, -41.20, 330.0),
        (-8.20, -42.20, 440.0),
        (-7.90, -43.20, 550.0),
        (-7.60, -44.20, 660.0),
        (-7.30, -45.20, 770.0),
    ],
    324: [
        (-12.40, -38.40, 0.0),
        (-12.00, -39.20, 90.0),
        (-11.50, -40.00, 180.0),
        (-11.00, -40.80, 270.0),
        (-10.50, -41.50, 360.0),
        (-9.90, -42.20, 460.0),
        (-9.40, -42.90, 550.0),
        (-8.90, -43.60, 640.0),
    ],
    407: [
        (-3.75, -38.50, 0.0),
        (-3.40, -39.20, 90.0),
        (-3.10, -40.00, 190.0),
        (-2.90, -41.00, 300.0),
        (-2.80, -42.00, 410.0),
        (-2.90, -43.00, 520.0),
        (-3.10, -44.00, 630.0),
        (-3.40, -45.00, 740.0),
    ],
}

MUNICIPALITIES = {
    101: ["Salvador", "Feira de Santana", "Itabuna", "Ilhéus", "Eunápolis", "Aracaju", "Maceió", "Natal"],
    116: ["Fortaleza", "Sobral", "Russas", "Limoeiro do Norte", "Iguatu", "Picos", "Petrolina", "Salgueiro"],
    232: ["Recife", "Olinda", "Caruaru", "Arcoverde", "Serra Talhada", "Petrolina", "Salgueiro"],
    316: ["Salvador", "Camaçari", "Alagoinhas", "Feira de Santana", "Vitória da Conquista", "Barreiras"],
    324: ["Salvador", "Feira de Santana", "Serrinha", "Euclides da Cunha", "Paulo Afonso", "Petrolina"],
    407: ["Fortaleza", "Sobral", "Tianguá", "Ubajara", "Parnaíba", "Piripiri", "Teresina"],
}

CAUSES = [
    "Ingestão de álcool pelo condutor",
    "Condutor deixou de manter distância do veículo da frente",
    "Velocidade incompatível",
    "Desobediência às normas de trânsito pelo condutor",
    "Falta de atenção à condução",
    "Ultrapassagem indevida",
    "Manobra brusca",
    "Pista escorregadia",
    "Defeito mecânico no veículo",
    "Sinalização inadequada",
    "Condutor dormiu ao volante",
    "Animais na pista",
]

TYPES = [
    "Colisão traseira",
    "Colisão frontal",
    "Colisão lateral",
    "Capotamento",
    "Tombamento",
    "Atropelamento de pedestre",
    "Queda de motocicleta",
    "Engavetamento",
    "Colisão com objeto fixo",
    "Saída de pista",
]

PHASES = ["Pleno dia", "Plena Noite", "Anoitecer", "Amanhecer"]
PHASE_PROBS = [0.55, 0.32, 0.07, 0.06]


def _hotspot_anchors(rng: np.random.Generator) -> list[tuple[float, float, int, str, float]]:
    """Escolhe âncoras onde haverá concentração anormal de acidentes."""
    anchors: list[tuple[float, float, int, str, float]] = []
    for br, points in ROUTE_ANCHORS.items():
        for index in rng.choice(len(points), size=3, replace=False):
            lat, lng, km = points[int(index)]
            anchors.append(
                (lat, lng, br, MUNICIPALITIES[br][int(index) % len(MUNICIPALITIES[br])], km)
            )
    return anchors


def generate_dataframe(
    n_accidents: int = 30_000,
    years: list[int] | None = None,
    seed: int = 42,
) -> pd.DataFrame:
    """Gera um DataFrame sintético no schema da PRF."""
    rng = np.random.default_rng(seed)
    years = years or list(config.DEFAULT_YEARS)
    bras = list(ROUTE_ANCHORS.keys())
    anchors = _hotspot_anchors(rng)
    anchor_probs = np.ones(len(anchors)) / len(anchors)

    rows: list[dict] = []
    for accident_id in range(1, n_accidents + 1):
        if rng.random() < 0.62:
            anchor_index = int(rng.choice(len(anchors), p=anchor_probs))
            lat0, lng0, br, municipality, km_base = anchors[anchor_index]
            lat = lat0 + rng.normal(0, 0.0018)
            lng = lng0 + rng.normal(0, 0.0018)
            km = max(0.0, km_base + rng.normal(0, 2.5))
        else:
            br = int(rng.choice(bras))
            points = ROUTE_ANCHORS[br]
            start = points[int(rng.integers(0, len(points) - 1))]
            end = points[int(rng.integers(1, len(points)))]
            if start[2] > end[2]:
                start, end = end, start
            t = float(rng.random())
            lat = start[0] + (end[0] - start[0]) * t + rng.normal(0, 0.002)
            lng = start[1] + (end[1] - start[1]) * t + rng.normal(0, 0.002)
            km = start[2] + (end[2] - start[2]) * t
            municipality = MUNICIPALITIES[br][int(rng.integers(0, len(MUNICIPALITIES[br])))]

        year = int(rng.choice(years, p=_year_probs(years)))
        month = int(rng.integers(1, 13))
        day = int(rng.integers(1, 29))
        hour = int(rng.integers(0, 24))
        minute = int(rng.integers(0, 60))
        phase = str(rng.choice(PHASES, p=PHASE_PROBS))

        severity_draw = rng.random()
        if severity_draw < 0.07:
            deaths = int(rng.integers(1, 4))
            serious = int(rng.integers(0, 4))
            light = int(rng.integers(0, 5))
            classification = "Com Vítimas Fatais"
        elif severity_draw < 0.75:
            deaths = 0
            serious = int(rng.integers(0, 3))
            light = int(rng.integers(0, 4))
            classification = "Com Vítimas Feridas"
        else:
            deaths = 0
            serious = 0
            light = 0
            classification = "Sem Vítimas"

        unharmed = int(rng.integers(0, 4))
        people = deaths + serious + light + unharmed
        uf = _uf_for_br(br, rng)

        rows.append(
            {
                "id": str(202200000 + accident_id),
                "data_inversa": f"{year}-{month:02d}-{day:02d}",
                "dia_semana": "segunda-feira",
                "horario": f"{hour:02d}:{minute:02d}:00",
                "uf": uf,
                "br": str(br),
                "km": f"{km:.1f}".replace(".", ","),
                "municipio": municipality,
                "causa_acidente": str(rng.choice(CAUSES)),
                "tipo_acidente": str(rng.choice(TYPES)),
                "classificacao_acidente": classification,
                "fase_dia": phase,
                "sentido_via": str(rng.choice(["Crescente", "Decrescente"])),
                "condicao_metereologica": str(
                    rng.choice(["Céu Claro", "Nublado", "Chuvoso", "Neblina"], p=[0.55, 0.3, 0.12, 0.03])
                ),
                "tipo_pista": str(rng.choice(["Simples", "Dupla", "Múltipla"], p=[0.55, 0.4, 0.05])),
                "tracado_via": str(rng.choice(["Reta", "Curva", "Aclive", "Declive"], p=[0.6, 0.25, 0.08, 0.07])),
                "uso_solo": str(rng.choice(["Não", "Sim"], p=[0.8, 0.2])),
                "pessoas": str(people),
                "mortos": str(deaths),
                "feridos_leves": str(light),
                "feridos_graves": str(serious),
                "ilesos": str(unharmed),
                "ignorados": "0",
                "feridos": str(light + serious),
                "veiculos": str(int(rng.integers(1, 4))),
                "latitude": f"{lat:.8f}".replace(".", ","),
                "longitude": f"{lng:.8f}".replace(".", ","),
                "regional": f"SPRF-{uf}",
                "delegacia": f"DEL01-{uf}",
                "uop": f"UOP01-DEL01-{uf}",
            }
        )

    return pd.DataFrame(rows, columns=config.RAW_COLUMNS)


def _year_probs(years: list[int]) -> np.ndarray:
    weights = np.array([1.0 if year < max(years) else 0.65 for year in years])
    return weights / weights.sum()


def _uf_for_br(br: int, rng: np.random.Generator) -> str:
    mapping = {
        101: ["BA", "SE", "AL", "PE", "RN"],
        116: ["CE", "PI", "PE", "BA"],
        232: ["PE"],
        316: ["BA"],
        324: ["BA"],
        407: ["CE", "PI"],
    }
    return str(rng.choice(mapping.get(br, ["BA"])))


def generate_csv(path: str | Path, as_zip: bool = False, **kwargs) -> Path:
    """Grava o CSV sintético (ou ZIP) e devolve o caminho gerado."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    frame = generate_dataframe(**kwargs)
    frame.to_csv(
        target,
        sep=";",
        index=False,
        encoding="latin-1",
        quoting=1,
        lineterminator="\n",
    )
    logger.info("CSV sintético gerado em %s (%d linhas)", target, len(frame))
    return target
