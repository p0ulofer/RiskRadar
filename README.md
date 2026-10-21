# RiskRadar

Aplicativo móvel que mostra **trechos de risco de acidentes** nas rodovias
federais do Nordeste, a partir dos dados abertos da Polícia Rodoviária Federal
(PRF). O projeto tem duas partes:

1. **Pipeline em Python** — baixa/lê os CSVs da PRF, limpa os registros,
   agrupa acidentes próximos em hotspots, calcula um score de severidade e
   exporta `hotspots.json` + `meta.json`.
2. **App Expo/React Native** — mapa, filtros, detalhes do trecho, “Perto de
   mim”, alertas em primeiro plano e configurações. Funciona offline com um
   seed embarcado.

> Informação baseada em dados históricos; não substitui a atenção ao dirigir
> nem a sinalização da via. **Não use o celular enquanto dirige.**

## Arquitetura

```
┌──────────────────────────────┐
│ Dados abertos da PRF         │  CSVs/ZIPs anuais (2022–2026)
│ datatranAAAA.zip             │
└──────────────┬───────────────┘
               │ load + clean
               ▼
┌──────────────────────────────┐
│ Pipeline Python              │
│  load → clean → DBSCAN       │
│  → score → export            │
│  (opcional: Overpass/OSM)    │
└──────────────┬───────────────┘
               │ hotspots.json / meta.json
               ▼
┌──────────────────────────────┐        ┌─────────────────────┐
│ app/assets/data/ (seed)      │        │ Host estático       │
│ + cache local do aparelho    │◀───────│ EXPO_PUBLIC_DATA_URL│
└──────────────┬───────────────┘  HTTP  └─────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│ App Expo (Expo Go)           │
│ mapa · filtros · detalhes    │
│ perto de mim · alertas       │
└──────────────────────────────┘
```

## Estrutura do repositório

```
RiskRadar/
├── PIPELINE.md                 # especificação da missão
├── README.md
├── docs/
│   ├── DECISIONS.md            # decisões e alternativas descartadas
│   └── METODOLOGIA.md          # limpeza, clustering, score e OSM
├── pipeline/
│   ├── requirements.txt
│   ├── riskradar_pipeline/
│   │   ├── cli.py              # comando build / synthetic
│   │   ├── config.py           # todos os parâmetros
│   │   ├── load.py             # CSV/ZIP, encoding, consolidação
│   │   ├── clean.py            # validação e normalização
│   │   ├── cluster.py          # DBSCAN por (UF, BR)
│   │   ├── score.py            # UPS, score e níveis
│   │   ├── osm.py              # enriquecimento opcional (fase 8)
│   │   ├── synthetic.py        # fallback sintético
│   │   └── export.py           # schema, ids e escrita dos JSONs
│   ├── tests/                  # pytest
│   └── data/
│       ├── raw/                # CSVs baixados (gitignored)
│       ├── processed/          # saída do pipeline (gitignored)
│       └── cache/osm/          # cache da Overpass (gitignored)
└── app/
    ├── app/                    # rotas do expo-router
    │   ├── (tabs)/index.tsx    # mapa + filtros
    │   ├── (tabs)/nearby.tsx   # perto de mim
    │   ├── (tabs)/settings.tsx # configurações
    │   ├── hotspot/[id].tsx    # detalhes
    │   └── about.tsx           # metodologia e avisos
    ├── src/
    │   ├── components/         # UI reutilizável (inclui LeafletMap.tsx)
    │   ├── data/repository.ts  # seed, cache e atualização remota
    │   ├── lib/geo.ts          # haversine e índice espacial
    │   ├── lib/alerts.ts       # regras de alerta (puro/testável)
    │   ├── lib/notifications.ts # ponte tolerante a falhas do expo-notifications
    │   ├── lib/leaflet-assets.ts # Leaflet embutido (gerado)
    │   ├── store/              # settings, dados e alertas
    │   ├── theme/
    │   └── types/
    ├── scripts/                # geração dos assets do Leaflet
    └── assets/data/            # seed hotspots.json + meta.json
```

## Dados

### Fonte real

- **PRF — Dados Abertos:** <https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf>
- Arquivos usados: `datatran2022.zip` … `datatran2026.zip`, na visão
  **“Agrupados por ocorrência”** (uma linha por acidente).
- Recorte padrão: **Nordeste** (MA, PI, CE, RN, PB, PE, AL, SE, BA),
  **2022–2026**. 2026 é um ano parcial.
- Totais brutos: **326.815 acidentes no Brasil**, **71.302 no Nordeste**.

Para reproduzir, baixe os ZIPs (ou os CSVs extraídos) e coloque em
`pipeline/data/raw/`. O pipeline lê ZIPs e CSVs, detecta encoding/delimitador e
ignora arquivos de outros anos.

### Build do pipeline

```bash
cd pipeline
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python -m riskradar_pipeline.cli build \
  --raw data/raw \
  --out data/processed \
  --ufs MA PI CE RN PB PE AL SE BA \
  --years 2022 2026 \
  --copy-to-app
```

- `--years 2022 2026` é interpretado como **intervalo inclusivo**.
- `--copy-to-app` copia os JSONs para `app/assets/data/` (seed do app).
- Sem CSV válido, o pipeline gera dados sintéticos e marca
  `fonte = "sintetico"`; o app exibe um aviso de demonstração.
- Saídas: `pipeline/data/processed/hotspots.json` e `meta.json`.

Em sistemas com Python gerenciado pelo SO (Debian/Ubuntu recentes), use um
virtualenv ou `pip install --user --break-system-packages -r requirements.txt`.

### Enriquecimento com OpenStreetMap (opcional)

```bash
python -m riskradar_pipeline.cli build \
  --raw data/raw --out data/processed \
  --ufs MA PI CE RN PB PE AL SE BA --years 2022 2026 \
  --copy-to-app --with-infra \
  --osm-endpoint https://overpass.openstreetmap.fr/api/interpreter \
  --osm-batch-size 100 --osm-pause 10
```

Cada hotspot é consultado num raio de `radius_m + 100 m`; são contados
semáforos, faixas de pedestre, redutores de velocidade e câmeras. As respostas
ficam em `pipeline/data/cache/osm/`, então reexecuções não repetem consultas.
O campo opcional `infra` eleva o `schema_version` para 2. Se a Overpass falhar,
o build segue com schema 1 e o app continua funcionando.

> A Overpass é um serviço público e pode limitar a taxa de uso. O endpoint
> padrão é `overpass-api.de`; espelhos como `overpass.openstreetmap.fr` podem
> ser usados via `--osm-endpoint`. A ausência de infraestrutura no OSM não
> prova que ela não existe na via.

### Números do build de referência

| Métrica | Valor |
|---|---:|
| Acidentes carregados (NE) | 71.302 |
| Acidentes considerados após limpeza | 71.129 |
| Hotspots gerados | 2.546 |
| Níveis | 1.232 baixo · 803 médio · 381 alto · 130 crítico |
| `hotspots.json` | 1.857.889 bytes (~1,77 MB), schema 2 |
| Cortes de nível | médio 37 · alto 63 · crítico 171 |
| Infraestrutura OSM | 220 semáforos · 801 faixas · 874 redutores · 284 câmeras |

O build de referência enriqueceu **todos os 2.546 hotspots** com dados do
OpenStreetMap (17 lotes, sem falhas).

## App

### Pré-requisitos

- Node.js 20 LTS ou superior e npm.
- **Expo Go** compatível com o **Expo SDK 57** no celular (Android/iOS).
- Celular e computador na mesma rede Wi-Fi para abrir pelo Expo Go.

### Rodar

```bash
cd app
npm install
npx expo start
```

Escaneie o QR code com o Expo Go. O app abre com o **seed embarcado**: dados,
filtros, detalhes, “Perto de mim” e configurações funcionam sem internet. O
mapa usa **Leaflet + tiles do OpenStreetMap** dentro de um WebView; a biblioteca
do mapa vai embutida no app, mas os tiles precisam de rede para aparecer.

### Atualização remota dos dados

A atualização é opcional. Configure `EXPO_PUBLIC_DATA_URL` com a URL de um
diretório que contenha `meta.json` e `hotspots.json`:

```bash
EXPO_PUBLIC_DATA_URL=https://exemplo.com/riskradar npx expo start
```

O app baixa primeiro o `meta.json`, compara `data_version` e só então baixa o
`hotspots.json` completo. Falhas de rede mantêm os dados locais. Para testar
localmente:

```bash
python3 -m http.server 8000 --directory pipeline/data/processed
EXPO_PUBLIC_DATA_URL=http://SEU-IP-LOCAL:8000 npx expo start
```

Em produção, publique os dois arquivos em um host estático com HTTPS (GitHub
Pages, S3, Netlify etc.). O app não envia localização para servidores; a
localização só é usada no aparelho.

### Funcionalidades

- **Mapa:** Leaflet/OpenStreetMap em WebView (funciona no Expo Go em Android e
  iOS, onde o Google Maps nativo não é mais suportado), marcadores coloridos por
  nível, filtros por UF, BR e nível mínimo, legenda, card do trecho e atalho para
  os detalhes.
- **Detalhes:** vítimas, score, causas e tipos mais frequentes, distribuição
  por fase do dia e por ano (barras com `View`, sem lib de gráficos),
  infraestrutura OSM quando disponível e botão para abrir no app de mapas.
- **Perto de mim:** permissão de localização em primeiro plano, 20 hotspots
  mais próximos com distância, nível, BR e município.
- **Alertas em primeiro plano:** switch em Configurações, raio de
  500/1000/2000 m, nível mínimo, banner, notificação local e voz pt-BR
  opcional. Cooldown de 10 min por hotspot e 1 alerta a cada 30 s.
- **Configurações:** versão dos dados, origem (cache/seed), atualização
  manual, limpeza de cache e restauração dos padrões.
- **Sobre:** fonte, metodologia, limitações e aviso de segurança.

Alertas **não funcionam com o app fechado ou em segundo plano** — é uma
limitação deliberada do escopo e do Expo Go.

## Testes e verificação

```bash
# Pipeline
cd pipeline && python3 -m pytest -q

# App
cd app
npx tsc --noEmit
npm run lint
npx jest --runInBand
```

Cobertura atual:

- **30 testes** de pipeline (carga, limpeza, clustering, score, exportação,
  sintético e OSM com cliente falso).
- **27 testes** de app (haversine/índice espacial, regras de alerta,
  repositório com cache/seed/falha de rede e fallback de notificações).
- TypeScript strict sem erros e ESLint sem avisos.

## Documentação

- [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md): limpeza, DBSCAN, score,
  níveis, schema e ressalvas do OSM.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): decisões, motivos e alternativas
  descartadas.
- [`PIPELINE.md`](PIPELINE.md): especificação original da missão.

## Limitações conhecidas

- Os dados são **históricos**: o app não prevê acidentes futuros.
- Coordenadas da PRF podem ter imprecisão de dezenas/centenas de metros.
- Trechos com menos de 5 acidentes próximos (raio de 300 m) não viram hotspot.
- 2026 é parcial e não deve ser comparado diretamente a anos fechados.
- O mapa-base usa tiles do OpenStreetMap e exige internet para exibir o
  relevo/ruas; os dados de hotspots são sempre locais.
- O Google Maps nativo não funciona no Expo Go atual. Por isso o mapa é
  renderizado com Leaflet dentro de `react-native-webview`, sem chave de API.
- Uso dos tiles do OpenStreetMap sujeito à
  [política de uso](https://operations.osmfoundation.org/policies/tiles/) da
  OSM Foundation; para produção em escala, use um provedor de tiles próprio.
- Alertas só rodam em primeiro plano; notificações e voz dependem de
  permissões do sistema. No Expo Go, a notificação do sistema pode ficar
  indisponível (módulo nativo ausente); nesse caso o banner interno e a voz
  continuam funcionando.
- O enriquecimento OSM cobre apenas o que está mapeado e pode estar
  desatualizado.

## Próximos passos

1. **Alerta em segundo plano** com tarefa nativa/geofencing e notificações
   persistentes (exige build próprio, fora do Expo Go).
2. **Rotas:** cruzar o trajeto planejado com hotspots e avisar só os que estão
   à frente.
3. **Previsão com ML:** modelo por trecho/horário/clima, com validação
   temporal e explicabilidade.
4. **Expansão para todo o Brasil** e recortes anuais comparáveis.
5. **Curadoria de infraestrutura:** revisar o OSM e combinar com dados
   oficiais de sinalização/radares.
