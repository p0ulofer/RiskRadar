
# RiskRadar

Aplicativo móvel que mostra **trechos de risco de acidentes** nas rodovias
federais do Nordeste, a partir dos dados abertos da Polícia Rodoviária Federal
(PRF). O projeto tem duas partes:

1. **Pipeline em Python** — baixa/lê os CSVs da PRF, limpa os registros,
   agrupa acidentes próximos em hotspots, calcula um score de severidade e
   exporta `hotspots.json` + `meta.json`.
2. **App Expo/React Native** — mapa, filtros, detalhes do trecho, “Perto de
   mim”, acidentes em tempo real do TomTom, alertas em primeiro plano e
   configurações. Funciona offline com um seed embarcado.

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
│  load → clean → hotspots     │
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
│   │   ├── cluster.py          # picos de densidade por (UF, BR)
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
    │   ├── store/              # settings, dados, alertas e tráfego
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
| Hotspots gerados | 3.165 |
| Níveis | 1.582 baixo · 941 médio · 483 alto · 159 crítico |
| `hotspots.json` | 2.380.189 bytes (~2,27 MB), schema 2 |
| Cortes de nível | médio 39 · alto 71 · crítico 197 |
| Infraestrutura OSM | 368 semáforos · 1.318 faixas · 952 redutores · 407 câmeras |

O build de referência enriqueceu **todos os 3.165 hotspots** com dados do
OpenStreetMap (22 lotes, sem falhas).

Cada hotspot é a vizinhança de **300 m** em torno de um pico de densidade (no
mínimo 5 acidentes), com picos separados por pelo menos 600 m — assim os
círculos dos trechos não se sobrepõem no mapa. O trecho mais denso do
Nordeste (BR-101/PE, km 70, em Recife) reúne 184 acidentes em 5 anos, e não
2.709 em 87 km como no primeiro build (ver `docs/DECISIONS.md`, D24).

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
Pages, S3, Netlify etc.). A localização não é enviada como dado pessoal; para
os acidentes em tempo real, apenas a área geográfica consultada vai ao TomTom
(veja abaixo).

### Acidentes em tempo real (TomTom)

A camada de trânsito é opcional e usa a API de incidentes do **TomTom Orbis
Maps v2**. Crie uma conta no TomTom, gere uma chave e coloque no arquivo
`app/.env`:

```bash
# app/.env
EXPO_PUBLIC_TOMTOM_API_KEY=sua-chave-aqui
```

Reinicie o bundler limpando o cache: `npx expo start -c`. Sem a chave, o app
continua funcionando normalmente com os dados históricos.

O que a integração faz:

- consulta acidentes, interdições e veículos quebrados na **área visível do
  mapa** e num **raio de 30 km** ao redor do usuário, **somente dentro do
  Nordeste** (a consulta é recortada nessa região);
- atualiza a cada **5, 10, 15 (padrão) ou 20 minutos**, somente com o app
  aberto, e reaproveita o cache enquanto ele estiver válido;
- mostra a lista **Acidentes agora** em “Perto de mim”, com distância e horário
  do último reporte;
- dispara banner, notificação local e voz quando um acidente ou interdição
  entra no raio de alerta, com cooldown de 30 min por incidente e de 30 s entre
  alertas.

O plano gratuito do TomTom oferece **2.500 consultas por mês** para Incident
Details, e cada chamada aceita no máximo **10.000 km²**. Para preservar a cota,
o app **só consulta dentro do Nordeste** (MA, PI, CE, RN, PB, PE, AL, SE e BA):
ao navegar para fora da região, nenhuma requisição é feita e o mapa mostra
“Acidentes só no Nordeste”. A bbox visível é recortada no limite da região. O
app conta as consultas no aparelho, bloqueia novas chamadas ao atingir o limite
e orienta a aproximar o mapa quando a área visível é grande demais. Como o
contador é por instalação, reinstalar o app zera a contagem local — o controle
oficial é o do painel do TomTom.

> **Segurança da chave:** variáveis `EXPO_PUBLIC_*` ficam embutidas no bundle e
> podem ser extraídas do aplicativo. Restrinja a chave no painel do TomTom e,
> antes de publicar, considere mover as chamadas para um proxy próprio.

Atribuição exigida: **Incidentes: © TomTom**, exibida na lista, no card de
detalhe e nos alertas; a tela "Sobre" concentra as atribuições do mapa
(OpenStreetMap/ODbL) e do TomTom.

### Funcionalidades

- **Mapa:** Leaflet/OpenStreetMap em WebView (funciona no Expo Go em Android e
  iOS, onde o Google Maps nativo não é mais suportado), marcadores coloridos por
  nível, filtros por UF, BR e nível mínimo, legenda, card do trecho e atalho para
  os detalhes.
- **Detalhes:** vítimas, score, causas e tipos mais frequentes, distribuição
  por fase do dia e por ano (barras com `View`, sem lib de gráficos),
  infraestrutura OSM quando disponível e botão para abrir no app de mapas.
- **Perto de mim:** permissão de localização em primeiro plano, 20 hotspots
  mais próximos com distância, nível, BR e município. Ao abrir um item, o botão
  **Mostrar no mapa do RiskRadar** fecha os detalhes, vai para a aba Mapa,
  centraliza o trecho e o destaca mesmo que os filtros atuais escondam o nível.
  A seção **Acidentes agora** lista os incidentes do TomTom num raio de 30 km,
  com distância e horário do reporte; tocar num item abre o incidente no mapa.
- **Acidentes em tempo real:** camada do TomTom no mapa (ponto ou linha da via),
  legenda de acidente/interdição/veículo parado, descrição padronizada do evento
  no card, chip de status com atualização manual, cache local e cota mensal.
  Requer `EXPO_PUBLIC_TOMTOM_API_KEY`.
- **Alertas em primeiro plano:** switch em Configurações, raio de
  500/1000/2000 m, nível mínimo, banner, notificação local e voz pt-BR
  opcional. Cooldown de 10 min por hotspot e 1 alerta a cada 30 s. Acidentes e
  interdições do TomTom usam o mesmo raio, com cooldown de 30 min por incidente.
- **Configurações:** versão dos dados, origem (cache/seed), atualização
  manual, limpeza de cache, TomTom (toggles, intervalo, chave, última
  atualização e cota mensal) e restauração dos padrões.
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

- **34 testes** de pipeline (carga, limpeza, clustering, score, exportação,
  sintético e OSM com cliente falso).
- **60 testes** de app (haversine/índice espacial, regras de alerta de hotspots
  e de trânsito, cliente TomTom, cache/cota, repositório com cache/seed/falha
  de rede e fallback de notificações).
- TypeScript strict sem erros e ESLint sem avisos.

## Documentação

- [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md): limpeza, hotspots, score,
  níveis, schema e ressalvas do OSM.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): decisões, motivos e alternativas
  descartadas.
- [`PIPELINE.md`](PIPELINE.md): especificação original da missão.

## Limitações conhecidas

- Os dados são **históricos**: o app não prevê acidentes futuros. Os
  incidentes do TomTom são o único dado em tempo real e dependem da cobertura
  dele no trecho.
- O plano gratuito do TomTom tem **2.500 consultas/mês**; a cota mostrada é a
  contagem local do aparelho, não a do painel. Cada chamada cobre no máximo
  10.000 km², então mapas muito afastados mostram “Aproxime para ver acidentes”.
- A chave do TomTom em `EXPO_PUBLIC_*` fica embutida no bundle e pode ser
  extraída; para produção, use um proxy.
- Incidentes em tempo real podem estar incompletos, atrasados ou mudar depois
  do reporte; use como apoio, nunca como garantia de via livre.
- Coordenadas da PRF podem ter imprecisão de dezenas/centenas de metros: elas
  são georreferenciadas ao **trecho** da rodovia, não ao GPS do acidente, e
  vários acidentes compartilham a mesma coordenada.
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
  permissões do sistema. No Expo Go funcionam as **notificações locais**; o
  *push* remoto (servidor) não é suportado e exigiria development build.
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
