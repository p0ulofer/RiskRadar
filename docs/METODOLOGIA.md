# Metodologia do RiskRadar

## 1. Fonte dos dados

- **Fonte oficial:** Polícia Rodoviária Federal (PRF), Dados Abertos.
  <https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf>
- **Arquivos usados:** `datatran2022.zip` a `datatran2026.zip`, na versão
  "Agrupados por ocorrência" (um registro por acidente).
- **Período:** 2022 a 2026 (2026 é um ano parcial, com dados publicados até o
  momento da geração).
- **Recorte:** Nordeste — MA, PI, CE, RN, PB, PE, AL, SE, BA.

Números da inspeção dos arquivos brutos:

| Ano | Acidentes no Brasil | Acidentes no Nordeste |
|---|---:|---:|
| 2022 | 64.606 | 13.640 |
| 2023 | 67.766 | 14.643 |
| 2024 | 73.202 | 16.382 |
| 2025 | 72.529 | 16.019 |
| 2026 (parcial) | 48.712 | 10.618 |
| **Total** | **326.815** | **71.302** |

- Encoding: `latin-1`; delimitador: `;`; decimais com vírgula.
- O `id` é único entre todos os anos (0 duplicatas). Por segurança, a chave
  interna é `(ano, id)`.

## 2. Limpeza

1. Nomes de colunas normalizados (minúsculas, sem acento, `snake_case`).
2. Latitude, longitude e km convertidos para `float`, aceitando vírgula decimal.
3. Descarte de registros sem coordenadas, com `(0,0)` ou fora do retângulo do
   Brasil (`lat -34..6`, `lng -75..-33`).
4. Filtro por UF e ano do recorte.
5. Descarte de BR inválida (`BR <= 0`).
6. Normalização de texto (espaços e capitalização de município/fase do dia) e
   conversão de vítimas para inteiros.
7. Remoção de duplicatas `(ano, id)`.

No build de referência: 71.129 acidentes considerados; 1 descartado por
coordenada fora do Brasil e 172 por BR inválida.

## 3. Clusterização (DBSCAN)

- Executada **separadamente para cada par (UF, BR)**, para nunca misturar
  rodovias diferentes.
- Métrica `haversine` com coordenadas em radianos, `algorithm="ball_tree"`.
- `eps = 300 m / 6.371.000 m` (≈ 0,0000471 rad) e `min_samples = 5`.
- Todo ponto com label `-1` (ruído) é descartado.
- Para cada cluster:
  - centro = média das coordenadas dos acidentes;
  - `radius_m` = percentil 90 das distâncias haversine ao centro, limitado ao
    intervalo `[100, 500]` metros.

## 4. Score de severidade

Inspirado na Unidade Padrão de Severidade (UPS) da PRF. Cada acidente vale:

| Situação | Pontos |
|---|---:|
| Sem vítimas | 1 |
| Com feridos (leves ou graves) | 4 |
| Com mortos | 13 |

A classificação oficial do acidente (`classificacao_acidente`) tem prioridade.
Se estiver ausente ou desconhecida, os pontos são derivados de `mortos` e
`feridos_graves + feridos_leves`.

O **score do hotspot** é a soma dos pontos dos acidentes do cluster. Os níveis
são calculados por percentis do score entre todos os hotspots gerados:

- `critico`: score ≥ p95;
- `alto`: score ≥ p80;
- `medio`: score ≥ p50;
- `baixo`: abaixo de p50.

Um hotspot é um trecho de aproximadamente 100–500 m de raio, e não uma
previsão: ele resume o histórico de acidentes naquele local.

## 5. Campos exportados

Cada hotspot contém: `id`, `lat`, `lng`, `radius_m`, `br`, `uf`, `municipio`,
`km_min`, `km_max`, `n_acidentes`, `mortos`, `feridos_graves`,
`feridos_leves`, `ilesos`, `score`, `level`, `top_causas`, `top_tipos`,
`fase_dia`, `por_ano` e, opcionalmente, `infra` (fase OSM).

O arquivo `hotspots.json` inclui um bloco `meta` com versão de schema, data de
geração, `data_version`, fonte (`prf` ou `sintetico`), UFs, anos, parâmetros,
cortes de nível e totais.

## 6. Enriquecimento com OpenStreetMap (opcional)

Com `--with-infra`, cada hotspot é consultado na Overpass API num raio de
`radius_m + 100 m`. São contados:

- `traffic_signals` (semáforos);
- `crossing` (faixas de pedestre);
- `traffic_calming` (lombadas, platôs e outros redutores);
- `speed_camera` (câmeras/radares mapeados).

A consulta agrupa vários hotspots por requisição, usa cache em disco e retry
com backoff. O resultado é gravado no campo opcional `infra` e eleva o
`schema_version` para 2. O app continua compatível com documentos sem esse
campo (schema 1).

No build de referência, todos os 2.546 hotspots foram enriquecidos (17 lotes,
sem falhas), somando 220 semáforos, 801 faixas de pedestre, 874 redutores de
velocidade e 284 câmeras de velocidade.

**Importante:** a ausência de um item no OSM não prova que ele não existe na
via; o mapa colaborativo pode estar desatualizado ou incompleto. A contagem é
informativa e não substitui vistoria ou sinalização oficial.

## 7. Limitações

- **Dados históricos não preveem acidentes futuros.** O mapa mostra onde
  acidentes ocorreram no passado, não onde ocorrerão.
- **Coordenadas da PRF podem ter imprecisão** de dezenas/centenas de metros.
- O recorte é o Nordeste e os anos 2022–2026; conclusões não se generalizam
  automaticamente para outras regiões ou períodos.
- 2026 é um ano parcial, portanto seus totais não são comparáveis aos anos
  fechados.
- A clusterização depende dos parâmetros `eps` e `min_samples`; trechos com
  menos de 5 acidentes próximos não viram hotspot.
- O app não substitui a sinalização da via, a atenção do condutor ou as
  orientações das autoridades de trânsito.
