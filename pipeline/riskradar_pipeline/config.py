"""Parâmetros centralizados do pipeline de hotspots.

Nenhum parâmetro de clusterização, score ou exportação deve ficar espalhado
pelo código: todos ficam aqui para auditoria e reprodutibilidade.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Recorte geográfico
# ---------------------------------------------------------------------------

# Retângulo que contém o Brasil (usado para descartar coordenadas inválidas).
BRAZIL_BOUNDS = {
    "lat_min": -34.0,
    "lat_max": 6.0,
    "lng_min": -75.0,
    "lng_max": -33.0,
}

# Unidades da federação do Nordeste (padrão da missão).
NORTHEAST_UFS = ["MA", "PI", "CE", "RN", "PB", "PE", "AL", "SE", "BA"]

DEFAULT_UFS = NORTHEAST_UFS
DEFAULT_YEARS = [2022, 2023, 2024, 2025, 2026]

# ---------------------------------------------------------------------------
# Clusterização (DBSCAN por par UF/BR)
# ---------------------------------------------------------------------------

EARTH_RADIUS_M = 6_371_000.0
DBSCAN_EPS_M = 300.0
DBSCAN_MIN_SAMPLES = 5
# scikit-learn espera coordenadas em radianos quando métrica = haversine.
DBSCAN_EPS_RAD = DBSCAN_EPS_M / EARTH_RADIUS_M

# Raio visual do hotspot (percentil 90 das distâncias ao centro).
RADIUS_PERCENTILE = 90
RADIUS_MIN_M = 100
RADIUS_MAX_M = 500

# ---------------------------------------------------------------------------
# Score de severidade (inspirado na UPS da PRF)
# ---------------------------------------------------------------------------

SEVERITY_WEIGHTS = {
    "sem_vitimas": 1,
    "feridos": 4,
    "mortos": 13,
}

# Cortes de nível calculados por percentil do score entre todos os hotspots.
LEVEL_PERCENTILES = {
    "medio": 50,
    "alto": 80,
    "critico": 95,
}

LEVELS = ["baixo", "medio", "alto", "critico"]

# ---------------------------------------------------------------------------
# Exportação
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 1
HOTSPOT_ID_DIGITS = 4
COORD_DECIMALS = 5
TOP_ITEMS = 3
MAX_JSON_BYTES_WARN = 5 * 1024 * 1024  # ~5 MB

# ---------------------------------------------------------------------------
# Dados de entrada
# ---------------------------------------------------------------------------

RAW_COLUMNS = [
    "id",
    "data_inversa",
    "dia_semana",
    "horario",
    "uf",
    "br",
    "km",
    "municipio",
    "causa_acidente",
    "tipo_acidente",
    "classificacao_acidente",
    "fase_dia",
    "sentido_via",
    "condicao_metereologica",
    "tipo_pista",
    "tracado_via",
    "uso_solo",
    "pessoas",
    "mortos",
    "feridos_leves",
    "feridos_graves",
    "ilesos",
    "ignorados",
    "feridos",
    "veiculos",
    "latitude",
    "longitude",
    "regional",
    "delegacia",
    "uop",
]

VICTIM_COLUMNS = ["mortos", "feridos_leves", "feridos_graves", "ilesos"]

# Aliases tolerados entre anos/formatos da PRF. A chave é o nome já normalizado.
COLUMN_ALIASES = {
    "data": "data_inversa",
    "data_acidente": "data_inversa",
    "hora": "horario",
    "hora_acidente": "horario",
    "municipio_acidente": "municipio",
    "municipio_nome": "municipio",
    "rodovia": "br",
    "br_rodovia": "br",
    "quilometro": "km",
    "km_acidente": "km",
    "causa": "causa_acidente",
    "tipo": "tipo_acidente",
    "classificacao": "classificacao_acidente",
    "latitude_acidente": "latitude",
    "longitude_acidente": "longitude",
}
