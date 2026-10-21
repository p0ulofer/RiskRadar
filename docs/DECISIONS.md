# Decisões do projeto RiskRadar

Este documento registra as decisões tomadas durante a execução do pipeline.
Formato: **decisão**, **motivo** e **alternativas descartadas**.

## Fase 1 — Dados

### D1. Usar os arquivos reais da PRF de 2022 a 2026
- **Decisão:** baixar os CSVs oficiais "Agrupados por ocorrência" (`datatran2022.zip` a `datatran2026.zip`) a partir dos links publicados na página oficial de Dados Abertos da PRF.
- **Motivo:** os arquivos estavam acessíveis; a missão prioriza dados reais e só admite o gerador sintético como fallback.
- **Alternativas descartadas:** dados sintéticos (desnecessários) e o projeto antigo (proibido pela missão).

### D2. Arquivos já estão no nível de ocorrência
- **Decisão:** não consolidar linhas na carga real. Cada arquivo `datatranAAAA.csv` tem exatamente uma linha por `id`.
- **Motivo:** a inspeção mostrou 64.606 / 67.766 / 73.202 / 72.529 / 48.712 linhas e a mesma quantidade de `id` únicos em 2022–2026.
- **Alternativa descartada:** usar o arquivo "todas as causas e tipos" e consolidar. A consolidação continua implementada e testada para tolerar esse formato no futuro.

### D3. Encoding e delimitador
- **Decisão:** detectar automaticamente o encoding (utf-8-sig/utf-8 e fallback latin-1) e o delimitador (`;` ou `,`), com preferência por `;` quando a linha de cabeçalho tem mais ponto e vírgula.
- **Motivo:** os arquivos reais são latin-1 com `;`; a detecção evita quebrar caso a PRF publique uma variação.
- **Alternativa descartada:** fixar `latin-1` e `;` no código.

### D4. Números decimais com vírgula
- **Decisão:** converter latitude, longitude e km com uma função que troca vírgula por ponto e remove separador de milhar quando os dois separadores aparecem.
- **Motivo:** os arquivos usam `-8,0512` e `415,5`.
- **Alternativa descartada:** `pandas.read_csv(decimal=",")`, que não cobre a mistura de separadores e dificulta os testes isolados.

### D5. Chave composta (ano, id)
- **Decisão:** usar `(ano, id)` como chave de acidente, mesmo tendo sido verificado que `id` é único entre todos os anos (0 duplicatas em 326.815 registros).
- **Motivo:** segurança contra mudanças de numeração em publicações futuras, conforme a missão.
- **Alternativa descartada:** usar apenas `id`.

### D6. Vítimas em arquivos com múltiplas linhas por acidente
- **Decisão:** na consolidação, verificar por `(ano, id)` se as colunas de vítimas variam. Se não variam, usar o primeiro valor; se variam, somar. As demais colunas usam o primeiro valor.
- **Motivo:** atender aos dois formatos possíveis sem inventar dados.
- **Resultado real:** não se aplica aos arquivos de 2022–2026, que já são agrupados por ocorrência. O comportamento está coberto por testes.

### D7. Registros descartados na limpeza
- **Decisão:** descartar registros sem coordenadas, com `(0,0)`, fora do retângulo do Brasil, com UF/ano não solicitados ou com BR inválida (`BR <= 0`).
- **Motivo:** esses registros não permitem posicionamento geográfico ou não pertencem ao recorte.
- **Números do build real (NE, 2022–2026):** 1 coordenada fora do Brasil e 172 registros com BR inválida (`BR = 0`). Nenhuma coordenada ausente ou `(0,0)`.

## Fase 2 — Pipeline

### D8. `--years 2022 2026` é um intervalo inclusivo
- **Decisão:** quando dois anos são informados, expandir para todos os anos entre eles (2022, 2023, 2024, 2025, 2026).
- **Motivo:** é a leitura da interface pedida na missão e permite comparar o recorte completo.
- **Alternativa descartada:** tratar os dois valores como uma lista de apenas dois anos.

### D9. DBSCAN por (UF, BR)
- **Decisão:** rodar DBSCAN separadamente para cada par (UF, BR), com `haversine`, coordenadas em radianos, `algorithm="ball_tree"`, `eps = 300/6371000` e `min_samples = 5`. Ruído é descartado.
- **Motivo:** evita fundir rodovias diferentes e segue exatamente os parâmetros da missão.
- **Alternativa descartada:** clusterizar tudo de uma vez e filtrar por BR depois.

### D10. Raio do hotspot
- **Decisão:** centro pela média das coordenadas; `radius_m` = percentil 90 das distâncias haversine ao centro, limitado a `[100, 500]` m.
- **Motivo:** representa a extensão típica do trecho sem ser distorcido por outliers.
- **Alternativa descartada:** raio fixo de 300 m para todos os hotspots.

### D11. Score e níveis
- **Decisão:** pontos por acidente = 1 (sem vítimas), 4 (com feridos) ou 13 (com mortos), usando `classificacao_acidente` quando reconhecida e, na ausência, derivando de `mortos`/`feridos`. O score é a soma dos pontos do cluster. Níveis: `critico` ≥ p95, `alto` ≥ p80, `medio` ≥ p50, `baixo` abaixo.
- **Motivo:** segue a inspiração na UPS da PRF e a regra de percentis da missão.
- **Alternativa descartada:** média de pontos por acidente (perderia o volume de acidentes do trecho).

### D12. Ids dos hotspots
- **Decisão:** `UF-BR-NNNN`, com `NNNN` reiniciando em `0001` por par (UF, BR) e ordenado por score decrescente.
- **Motivo:** legível, estável dentro do mesmo build e segue o exemplo `PE-101-0007`.
- **Alternativa descartada:** hash aleatório (difícil de ler) ou sequência global (muda quando outra UF é incluída).

### D13. Hash e versão dos dados
- **Decisão:** `data_version = AAAAMMDD-<8 primeiros hex do SHA-256 do conteúdo canônico de hotspots + parâmetros>`; `generated_at` em UTC.
- **Motivo:** o app compara versões sem baixar o arquivo grande; o hash muda quando os dados mudam.
- **Alternativa descartada:** usar apenas a data (não detectaria reprocessamento no mesmo dia).

### D14. Fallback sintético
- **Decisão:** manter `synthetic.py` e acioná-lo automaticamente se não houver CSV válido; nesse caso `fonte = "sintetico"` e o app exibe "Dados de demonstração".
- **Motivo:** a missão exige o fallback, embora o download real tenha funcionado.
- **Alternativa descartada:** falhar o build sem dados.

### D15. OpenStreetMap (fase opcional)
- **Decisão:** executar a fase 8 apenas após as fases 1–7 estarem completas e commitadas; se a Overpass API falhar, registrar e seguir.
- **Motivo:** a própria missão condiciona a fase opcional.

### D16. Enriquecimento OSM por hotspot, em lotes e com cache
- **Decisão:** consultar a Overpass API para cada hotspot, mas agrupar até 150 hotspots por requisição; contar `traffic_signals`, `crossing`, `traffic_calming` e `speed_camera` dentro de `radius_m + 100 m`; gravar cada resposta em cache SHA-1 em `pipeline/data/cache/osm/`; usar pausa entre requisições e retry com backoff exponencial; gerar `schema_version = 2` e campo opcional `infra`.
- **Motivo:** 2.546 requisições individuais seriam lentas e hostis ao serviço; o cache torna reexecuções baratas. Um elemento pode ser contado em dois hotspots se os raios se sobrepuserem, o que reflete a área de cada trecho.
- **Endpoint:** `overpass-api.de` respondia 502/504 durante a execução; foi usado o espelho `https://overpass.openstreetmap.fr/api/interpreter`, configurável com `--osm-endpoint`. A falha é tratada como opcional: após 3 lotes consecutivos com erro, o build segue sem `infra` e com schema 1.
- **Alternativas descartadas:** uma requisição por hotspot (lenta) e baixar um extrato Geofabrik do Brasil (centenas de MB, fora do escopo).

## Fase 3–7 — App

### D17. Expo SDK 57 e Expo Go
- **Decisão:** usar Expo SDK 57 (`expo ^57.0.0`, instalado 57.0.31), `expo-router`, TypeScript strict e apenas dependências nativas suportadas pelo Expo Go.
- **Motivo:** é a versão do Expo Go disponível no ambiente de teste; o projeto foi alinhado a ela com `npx expo install --fix`.
- **Observação:** as dependências de desenvolvimento também foram alinhadas (Jest 29, `jest-expo` 57, `eslint-config-expo` 57). O `expo-doctor` passa em 21/21 checks.

### D18. Dados locais: seed + cache + atualização opcional
- **Decisão:** embarcar `hotspots.json` em `app/assets/data/` como seed; na inicialização, usar cache em arquivo se válido e cair para o seed em qualquer erro; atualização remota só ocorre se `EXPO_PUBLIC_DATA_URL` estiver definida e a `data_version` remota for diferente.
- **Motivo:** o app precisa abrir offline e nunca ficar inutilizável por JSON corrompido ou falta de rede.

### D19. Alertas somente em primeiro plano
- **Decisão:** monitorar a posição com `watchPositionAsync` (precisão balanceada, `distanceInterval` de 50 m) apenas enquanto o app está aberto; notificações locais, banner e voz (opcional) ao entrar no raio configurado.
- **Motivo:** é o escopo explícito da missão; alertas em segundo plano exigiriam tarefa nativa e permissões adicionais, incompatíveis com Expo Go.
- **Regras:** cooldown de 10 minutos por hotspot e no máximo 1 alerta a cada 30 segundos; nível mínimo padrão `alto`.

### D20. Índice espacial em grade
- **Decisão:** indexar hotspots em células de 0,1° e consultar apenas as células vizinhas para filtros, mapa e “Perto de mim”.
- **Motivo:** evita varrer 2.546 hotspots a cada atualização de posição no modo alerta.
- **Alternativa descartada:** k-d tree (melhoraria consultas, mas adiciona dependência e complexidade para o volume atual).

### D21. Carregamento tardio do `expo-notifications`
- **Decisão:** não importar `expo-notifications` no topo dos módulos. A ponte `src/lib/notifications.ts` faz `require` sob demanda dentro de `try/catch`; se o módulo nativo não existir, o status vira `unavailable` e o app segue com banner e voz.
- **Motivo:** no Expo Go, o `import` estático de `expo-notifications` pode lançar `Cannot find native module 'ExpoTopicSubscriptionModule'` e derrubar o layout raiz inteiro (as rotas apareciam sem default export).
- **Alternativa descartada:** exigir um development build só para notificações, o que contraria o requisito de rodar no Expo Go.

### D22. Mapa com Leaflet/OpenStreetMap em WebView
- **Decisão:** substituir `react-native-maps` por `react-native-webview` com Leaflet 1.9.4 e tiles do OpenStreetMap. O JS/CSS do Leaflet é gerado por `scripts/generate-leaflet-assets.js` e embutido no bundle; os marcadores e o círculo do hotspot são sincronizados por mensagens entre o app e o WebView.
- **Motivo:** o Google Maps nativo não é mais suportado no Expo Go (a área do mapa ficava em branco). WebView/Leaflet funciona em Android e iOS no Expo Go, sem chave de API, e mantém o mapa alinhado à fonte OSM já usada no enriquecimento.
- **Limitação:** os tiles do OSM exigem internet; os dados dos hotspots continuam offline. Para uso em escala, trocar por um provedor de tiles próprio.
- **Alternativa descartada:** `expo-maps` (exige development build e não roda no Expo Go) e build nativo com chave do Google Maps (fora do escopo).

### D23. “Mostrar no mapa” a partir de “Perto de mim”
- **Decisão:** o detalhe de um hotspot aberto pela aba “Perto de mim” tem o botão **Mostrar no mapa do RiskRadar**. Ele fecha a pilha de detalhes e navega para a aba Mapa com `hotspotId` e um `focusAt` (nonce), que centraliza o ponto, seleciona o card e desenha o círculo do hotspot. O marcador é incluído mesmo se os filtros atuais excluírem o nível.
- **Motivo:** mantém o usuário no app e evita depender de um app de mapas externo; o nonce permite repetir a ação para o mesmo hotspot.
- **Alternativa descartada:** botão “Ver no mapa” em cada card da lista (duplicaria a ação e aumentaria o ruído visual).
