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

## 3. Clusterização (picos de densidade)

Executada **separadamente para cada par (UF, BR)**, para nunca misturar
rodovias diferentes. Um hotspot é a vizinhança de **300 m** em torno de um
*pico de densidade*, com no mínimo **5 acidentes** nessa vizinhança.

1. Para cada acidente, conta-se quantos existem a até 300 m (a mesma definição
   de núcleo do DBSCAN com `eps=300` e `min_samples=5`).
2. Os acidentes com contagem ≥ 5 são candidatos a pico.
3. Candidatos são ordenados por densidade (maior primeiro) eedy: um candidato é
   aceito só se nenhum pico já aceito estiver a menos de 600 m dele
   (supressão não máxima, 2× o raio do trecho — assim as circunferências dos
   trechos não se sobrepõem no mapa).
4. Cada pico vira um hotspot com os acidentes a até 300 m dele. Acidentes fora
   de qualquer vizinhança são descartados como ruído.

Para cada hotspot:

- centro = média das coordenadas dos acidentes do trecho;
- `radius_m` = percentil 90 das distâncias haversine ao centro, limitado ao
  intervalo `[100, 500]` metros;
- `km_min`/`km_max` = percentis 10 e 90 do km do **grupo dominante** (janela
  de 1 km em torno do km mais frequente) e `km_mediana` = mediana desse grupo.

### Por que não DBSCAN puro

O DBSCAN conecta acidentes vizinhos por densidade-alcançável. Numa rodovia
movimentada, cada acidente tem vizinhos a menos de 300 m, então a rodovia
inteira vira **um único cluster**: no build anterior, `BR-101/PE` agrupava
**2.709 acidentes em 87 km** (km 1–88) e o marcador era desenhado no
centroide, no meio de Recife, longe de qualquer concentração real. O método de
picos mantém exatamente a regra da missão — "mais de 5 acidentes num raio de
300 m" — sem o efeito de corrente: o mesmo trecho passou a ter no máximo
184 acidentes, com extensão de km coerente.

### Coordenadas georreferenciadas

A PRF **não georreferencia o acidente**: a coordenada é a do ponto de
referência do trecho da rodovia. Por isso muitos acidentes caem na mesma
coordenada (98 deles em um único ponto da BR-101/PE) e o `km` reportado pode
divergir dentro do mesmo ponto — a BR-116/BA, por exemplo, tem trechos com
numeração de km reiniciada. Por isso o app mostra o km de referência (mediana
do grupo dominante) e não o min/máximo bruto.

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
`km_min`, `km_max`, `km_mediana`, `n_acidentes`, `mortos`, `feridos_graves`,
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

No build de referência, todos os 3.165 hotspots foram enriquecidos (22 lotes,
sem falhas), somando 368 semáforos, 1.318 faixas de pedestre, 952 redutores de
velocidade e 407 câmeras de velocidade.

**Importante:** a ausência de um item no OSM não prova que ele não existe na
via; o mapa colaborativo pode estar desatualizado ou incompleto. A contagem é
informativa e não substitui vistoria ou sinalização oficial.

## 7. Limitações

- **Dados históricos não preveem acidentes futuros.** O mapa mostra onde
  acidentes ocorreram no passado, não onde ocorrerão.
- **Coordenadas da PRF podem ter imprecisão** de dezenas/centenas de metros:
  elas são georreferenciadas ao trecho da rodovia, não ao GPS do acidente, e
  vários acidentes compartilham a mesma coordenada.
- O recorte é o Nordeste e os anos 2022–2026; conclusões não se generalizam
  automaticamente para outras regiões ou períodos.
- 2026 é um ano parcial, portanto seus totais não são comparáveis aos anos
  fechados.
- A clusterização depende do raio (300 m) e do mínimo de acidentes (5);
  trechos com menos de 5 acidentes próximos não viram hotspot.
- O app não substitui a sinalização da via, a atenção do condutor ou as
  orientações das autoridades de trânsito.
