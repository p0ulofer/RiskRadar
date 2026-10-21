# MISSÃO

Construa do zero, de ponta a ponta e sem pedir aprovação intermediária, o projeto **RiskRadar**: um app mobile (React Native + Expo) que mostra num mapa os trechos de rodovias federais brasileiras com maior concentração de acidentes (hotspots), calculados a partir dos dados abertos da PRF, e avisa o usuário quando ele se aproxima de um trecho de risco.

Disciplina: [NOME DA DISCIPLINA]. Requisitos adicionais do professor: [COLE AQUI OU DEIXE "nenhum além do descrito neste documento"].

Existe um projeto antigo com a mesma ideia, mas NÃO use nem procure código dele. Tudo aqui parte do zero.

# REGRAS DE EXECUÇÃO

1. Execute todas as fases abaixo em ordem, sem parar para perguntar. Se algo for ambíguo, escolha a opção mais simples compatível com este documento e registre a decisão em `docs/DECISIONS.md` (decisão, motivo, alternativa descartada).
2. Só considere algo bloqueante se for impossível de contornar. Nesse caso, aplique o fallback descrito na própria fase, registre em `docs/DECISIONS.md` e siga em frente.
3. Faça um commit git ao final de cada fase (git init se necessário), com mensagem no padrão Conventional Commits (feat:, fix:, docs:, test:, chore:).
4. Nunca invente nomes de colunas, APIs ou versões. Inspecione os dados reais e consulte a documentação atual das bibliotecas. Use `npx expo install` para instalar dependências do app, para garantir compatibilidade com a versão do SDK.
5. Nunca commite segredos, chaves de API ou dados brutos pesados (use .gitignore).
6. Ao terminar cada fase, rode os testes/verificações dela e corrija o que falhar antes de avançar. No relatório final, diga exatamente o que foi testado e o que não foi possível testar (ex.: execução em dispositivo físico).
7. Idioma da interface, dos textos e da documentação: português do Brasil. Código e nomes de variáveis em inglês, exceto campos de dados herdados da PRF (snake_case em português).

# ESTRUTURA DO REPOSITÓRIO

```
riskradar/
├── README.md
├── .gitignore
├── docs/
│   ├── DECISIONS.md
│   └── METODOLOGIA.md
├── pipeline/                      # Python 3.11+
│   ├── requirements.txt
│   ├── data/raw/                  # gitignored
│   ├── data/processed/            # gitignored, exceto o JSON final copiado para o app
│   ├── riskradar_pipeline/
│   │   ├── config.py
│   │   ├── load.py
│   │   ├── clean.py
│   │   ├── cluster.py
│   │   ├── score.py
│   │   ├── export.py
│   │   ├── osm.py                 # fase opcional
│   │   ├── synthetic.py           # fallback
│   │   └── cli.py
│   └── tests/
└── app/                           # Expo + TypeScript + expo-router
    ├── app/
    │   ├── (tabs)/index.tsx       # Mapa
    │   ├── (tabs)/nearby.tsx      # Perto de mim
    │   ├── (tabs)/settings.tsx    # Configurações
    │   ├── hotspot/[id].tsx       # Detalhes
    │   └── about.tsx              # Sobre / metodologia
    ├── assets/data/hotspots.json  # seed embarcado (gerado pelo pipeline)
    └── src/{lib,data,hooks,store,components,theme,types}/
```

# FASE 1 — Obtenção e inspeção dos dados

1. Fonte oficial: https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf
2. Procure primeiro arquivos já presentes em `pipeline/data/raw/` (.csv ou .zip). Se houver .zip, descompacte.
3. Se não houver, tente baixar os arquivos de 2022 a 2026 do portal. Preferência: o arquivo agrupado **por ocorrência** (um registro por acidente). Se só estiver disponível o arquivo "todas_causas_tipos" (várias linhas por acidente), consolide por acidente.
4. Se o download for impossível (rede bloqueada, links dinâmicos), **fallback**: implemente `synthetic.py`, que gera um CSV sintético realista no mesmo schema (Nordeste, BRs reais como 101, 116, 232, 316, 324, 407; coordenadas plausíveis ao longo dessas rodovias; ~30 mil acidentes; concentrações propositais para formar hotspots; mistura de severidades, causas, tipos e fase do dia). Nesse caso, marque `"fonte": "sintetico"` no JSON final, exiba um aviso visível no app ("Dados de demonstração") e deixe no README as instruções para trocar pelos dados reais colocando os arquivos em `pipeline/data/raw/` e rodando o comando do pipeline.
5. Antes de escrever o código de carga, **inspecione os arquivos reais**: encoding (provavelmente latin-1), delimitador (provavelmente `;`), separador decimal das coordenadas e do km (provavelmente vírgula), nomes exatos das colunas e granularidade. Faça o `load.py` normalizar nomes de colunas (minúsculas, sem acento) e tolerar pequenas variações entre anos.
6. Verifique se o `id` é único entre anos. Por segurança, use a chave composta (ano, id).
7. Ao consolidar linhas múltiplas por acidente, verifique empiricamente se as colunas de vítimas (mortos, feridos_leves, feridos_graves, ilesos) se repetem iguais entre as linhas do mesmo id (então use o primeiro valor) ou diferem por linha (então some). Documente o que encontrou em `docs/DECISIONS.md`.

# FASE 2 — Pipeline de hotspots (Python)

Dependências: pandas, numpy, scikit-learn, pytest (e requests apenas na fase opcional de OSM). Interface: `python -m riskradar_pipeline.cli build --raw data/raw --out data/processed --ufs MA PI CE RN PB PE AL SE BA --years 2022 2026`.

**Limpeza (`clean.py`)**
- Converter latitude/longitude e km para float (vírgula → ponto).
- Descartar registros sem coordenadas, com (0,0) ou fora do retângulo do Brasil (lat -34 a 6, lng -75 a -33).
- Filtrar pelas UFs e anos pedidos. Normalizar texto (strip, capitalização consistente).
- Registrar no log quantos registros foram descartados e por quê.

**Clusterização (`cluster.py`)**
- Rodar DBSCAN **separadamente para cada par (UF, BR)**, para nunca fundir rodovias diferentes.
- Métrica `haversine` (coordenadas em radianos), `algorithm="ball_tree"`, `eps = 300 m / 6371000` (rad), `min_samples = 5`. Todos os parâmetros em `config.py`.
- Ruído (label -1) é descartado.
- Para cada cluster: centro = média das coordenadas; `radius_m` = percentil 90 das distâncias ao centro, limitado ao intervalo [100, 500].

**Severidade e score (`score.py`)**
- Pontos por acidente, inspirados na UPS (Unidade Padrão de Severidade), configuráveis: sem vítimas = 1, com feridos = 4, com mortos = 13 (use a classificação do acidente; se ausente, derive de mortos/feridos).
- `score` do hotspot = soma dos pontos dos acidentes do cluster.
- `level` por percentis do score entre todos os hotspots gerados: `critico` ≥ p95, `alto` ≥ p80, `medio` ≥ p50, `baixo` abaixo disso. Guarde os cortes em `meta`.

**Campos agregados por hotspot**
`id` (string estável do tipo "PE-101-0007", ordenado por score desc dentro da BR/UF), `lat`, `lng` (5 casas decimais), `radius_m`, `br`, `uf`, `municipio` (mais frequente), `km_min`, `km_max`, `n_acidentes`, `mortos`, `feridos_graves`, `feridos_leves`, `ilesos`, `score`, `level`, `top_causas` (até 3: `{nome, n}`), `top_tipos` (até 3), `fase_dia` (contagem por valor), `por_ano` (contagem por ano).

**Exportação (`export.py`)**
- Gerar `hotspots.json` compacto (sem indentação, `separators=(",", ":")`) com este schema:
```json
{
  "meta": {
    "schema_version": 1,
    "generated_at": "ISO-8601",
    "data_version": "AAAAMMDD-<hash curto do conteúdo>",
    "fonte": "prf" | "sintetico",
    "ufs": ["PE", "..."],
    "anos": [2022, 2026],
    "params": { "eps_m": 300, "min_samples": 5, "pesos": {"sem_vitimas": 1, "feridos": 4, "mortos": 13} },
    "cortes_nivel": { "medio": 0, "alto": 0, "critico": 0 },
    "total_acidentes_considerados": 0,
    "total_hotspots": 0
  },
  "hotspots": [ ... ]
}
```
- Gerar também `meta.json` separado (só o bloco `meta`), usado pelo app para checar atualização sem baixar o arquivo grande.
- Validar o JSON contra um schema (jsonschema ou validação manual em teste) e falhar o build se inválido. Meta: arquivo final abaixo de ~5 MB para o Nordeste.
- Copiar `hotspots.json` e `meta.json` para `app/assets/data/` ao final do build (flag `--copy-to-app`).

**Testes (pytest)**
- Clusterização com pontos sintéticos conhecidos (dois grupos em BRs diferentes não se fundem; ruído é descartado).
- Cálculo de score e níveis.
- Limpeza (coordenadas inválidas, vírgula decimal).
- Validação do schema de saída.

Escreva `docs/METODOLOGIA.md` explicando fontes, limpeza, DBSCAN, score e limitações (dados históricos, não preveem acidentes futuros; coordenadas da PRF podem ter imprecisão).

# FASE 3 — Esqueleto do app

- `npx create-expo-app` com template TypeScript, expo-router, SDK estável mais recente. Modo strict do TypeScript ligado, ESLint configurado.
- Instalar via `npx expo install`: react-native-maps, expo-location, expo-notifications, expo-speech, expo-file-system, @react-native-async-storage/async-storage. Para testes: jest-expo + @testing-library/react-native.
- O app deve rodar no **Expo Go** (sem development build, sem chave de API paga). Notificações: apenas **locais**.
- Tipos TypeScript em `src/types/` espelhando exatamente o schema do JSON.
- Tema simples (claro/escuro automático), cores por nível: baixo = verde, medio = amarelo, alto = laranja, critico = vermelho.

# FASE 4 — Camada de dados e geografia

**`src/data/repository.ts`**
- Ordem de carregamento: (1) cópia em cache no sistema de arquivos (expo-file-system), se existir; (2) fallback para o seed embarcado `assets/data/hotspots.json`. O app SEMPRE funciona offline com o seed.
- Atualização: se `EXPO_PUBLIC_DATA_URL` estiver definida, baixar `meta.json` dessa URL, comparar `data_version` com a versão atual e, se diferente, baixar `hotspots.json`, validar o formato mínimo e só então substituir o cache. Falhas de rede nunca derrubam o app (mostrar aviso discreto).
- Settings e metadados leves em AsyncStorage; o JSON grande vai em arquivo.

**`src/lib/geo.ts`** (funções puras, 100% testadas com jest)
- `haversineMeters(a, b)`.
- Índice espacial em grade (células de 0,1°) para consultas `hotspotsWithinRadius(point, radiusM)` e `nearestHotspots(point, n)`, evitando varrer milhares de itens a cada atualização de GPS.
- `hotspotsInRegion(region, limit)` para filtrar pelo retângulo visível.

# FASE 5 — Mapa, filtros e detalhes

**Tela Mapa (`(tabs)/index.tsx`)**
- `MapView` centrado inicialmente no Nordeste (ou na posição do usuário, se a permissão já tiver sido concedida).
- Renderizar apenas hotspots dentro da região visível (atualizar em `onRegionChangeComplete`, com debounce), no máximo 150 por vez, priorizando maior score. Em zoom muito aberto, mostrar só `alto` e `critico`.
- Marcadores coloridos por nível, com `tracksViewChanges={false}`. Desenhar um `Circle` do `radius_m` apenas para o hotspot selecionado.
- Filtros (modal ou barra superior): UF, BR e nível mínimo. Filtros persistem entre sessões.
- Legenda de cores. Se `fonte === "sintetico"`, faixa visível "Dados de demonstração".
- Toque no marcador abre um resumo curto e leva à tela de detalhes.

**Tela Detalhes (`hotspot/[id].tsx`)**
- Título "BR-101/PE · Recife · km 85–87", badge do nível, score.
- Números: acidentes, mortos, feridos graves, feridos leves.
- Principais causas e tipos, distribuição por fase do dia e por ano (barras simples feitas com View, sem biblioteca de gráficos).
- Botão "Abrir no app de mapas" (Linking com geo:/maps:) para o ponto do hotspot.

# FASE 6 — Perto de mim e alertas

**Tela Perto de mim**
- Pede permissão de localização em primeiro plano (explicando o motivo antes). Lista os 20 hotspots mais próximos com distância, nível, BR e município, ordenados por distância. Toque leva aos detalhes. Estados tratados: permissão negada (botão para abrir ajustes), GPS desligado, sem posição ainda.

**Modo alerta (primeiro plano apenas)**
- Switch "Ativar alertas" em Configurações. Usa `watchPositionAsync` (precisão balanceada, `distanceInterval` ≈ 50 m).
- Lógica pura e testável em `src/lib/alerts.ts`: `evaluateAlerts(position, index, settings, state, now)` retorna os alertas a disparar. Regras:
  - Dispara quando a distância até o hotspot ≤ raio de alerta (padrão 1000 m; opções 500/1000/2000 m).
  - Só para níveis ≥ nível mínimo de alerta (padrão `alto`).
  - **Cooldown** de 10 minutos por hotspot e no máximo 1 alerta a cada 30 segundos no total.
  - Mensagem: "Trecho de risco {nível} à frente: BR-{br}, {município}. {n} acidentes, {mortos} mortes registradas."
- Ao disparar: banner no app, notificação local (expo-notifications) e, se habilitado, fala por voz (expo-speech, pt-BR). O alerta nunca exige interação.
- Tratar a permissão de notificações negada sem quebrar o resto.

**Testes (jest):** `haversineMeters`, índice espacial, `evaluateAlerts` (raio, nível mínimo, cooldown global e por hotspot), repositório (cache vs. seed vs. falha de rede, com mocks).

# FASE 7 — Configurações, offline e Sobre

- **Configurações:** raio de alerta, nível mínimo de alerta, voz ligada/desligada, ativar alertas, botão "Atualizar dados agora" (mostra `data_version`, data de geração e fonte), limpar cache.
- **Sobre:** origem dos dados (PRF), resumo da metodologia do score e dos hotspots, aviso: "Informação baseada em dados históricos; não substitui a atenção ao dirigir nem a sinalização da via. Não use o celular enquanto dirige."
- Tratar tudo que pode falhar: sem internet, JSON corrompido (cai para o seed), sem permissões.
- Remover logs de debug e avisos de lint/TypeScript.

# FASE 8 — OPCIONAL: enriquecimento com OpenStreetMap

Execute somente depois que as fases 1–7 estiverem completas, testadas e commitadas. Se falhar por rede, registre e pule.
- `osm.py`: para **cada hotspot** (não cada acidente), consultar a Overpass API num raio = `radius_m + 100 m` e contar `traffic_signals`, `crossing`, `traffic_calming` e `speed_camera`. Consultas em lote, respeitando limites de taxa (pausa entre requisições, retry com backoff), com cache em disco para não repetir.
- Adicionar o campo opcional `infra` (`{traffic_signals, crossing, traffic_calming, speed_camera}`) ao hotspot. Incrementar `schema_version` para 2 e manter o app compatível com a ausência do campo.
- Mostrar a infraestrutura na tela de detalhes quando existir.

# FASE 9 — Documentação e verificação final

- `README.md` na raiz: o que é o projeto, arquitetura (diagrama em texto), pré-requisitos, como rodar o pipeline (inclusive como colocar os CSVs reais), como rodar o app no Expo Go, variáveis de ambiente (`EXPO_PUBLIC_DATA_URL`), como rodar os testes, limitações conhecidas e próximos passos (alerta em segundo plano, rotas, previsão com ML, expansão para todo o Brasil).
- Rodar e corrigir: `pytest` no pipeline; `tsc --noEmit`, lint e jest no app; iniciar o app (`npx expo start`) e confirmar que o bundle compila sem erros.
- Confirmar que o app abre com o seed embarcado, sem internet.

# DEFINIÇÃO DE PRONTO

- [ ] `python -m riskradar_pipeline.cli build ...` gera `hotspots.json` e `meta.json` válidos e copia para o app.
- [ ] App roda no Expo Go com mapa, filtros, detalhes, "Perto de mim", alertas em primeiro plano, configurações e tela Sobre.
- [ ] Funciona offline com o seed embarcado.
- [ ] Testes do pipeline e do app passam; TypeScript sem erros.
- [ ] Nenhum segredo ou dado bruto pesado commitado.
- [ ] `docs/DECISIONS.md`, `docs/METODOLOGIA.md` e `README.md` completos.

# RELATÓRIO FINAL (obrigatório)

Ao terminar, entregue um resumo com: o que foi construído por fase; se os dados usados são reais ou sintéticos; números do build (acidentes considerados, hotspots gerados, tamanho do JSON); o que foi testado e como; o que NÃO foi possível testar; decisões relevantes tomadas; e os próximos passos recomendados.
