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

## Fase 3–7 — App

As decisões do app estão registradas nas seções seguintes, acrescentadas durante a execução.
