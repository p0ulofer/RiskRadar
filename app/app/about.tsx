import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { formatDate } from '@/lib/format';
import { useData } from '@/store/data';
import { radius, useTheme } from '@/theme';

const PRF_URL =
  'https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf';

export default function AboutScreen() {
  const { colors } = useTheme();
  const { document, source } = useData();
  const hasInfra = document.hotspots.some((hotspot) => hotspot.infra !== undefined);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>O que é o RiskRadar</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          O RiskRadar mostra, num mapa, os trechos de rodovias federais brasileiras com maior
          concentração histórica de acidentes — os hotspots — e avisa quando você se aproxima de um
          deles. O recorte atual é o Nordeste, com dados de 2022 a 2026.
        </Text>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Fonte dos dados</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Dados abertos da Polícia Rodoviária Federal (PRF), arquivos “Agrupados por ocorrência”.
          Cada registro representa um acidente com data, rodovia, km, município, coordenadas,
          vítimas, causa, tipo e fase do dia.
        </Text>
        <View style={[styles.infoRow, { borderColor: colors.border }]}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Fonte atual</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {document.meta.fonte === 'prf' ? 'PRF (dados reais)' : 'Demonstração (sintética)'}
          </Text>
        </View>
        <View style={[styles.infoRow, { borderColor: colors.border }]}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Versão dos dados</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{document.meta.data_version}</Text>
        </View>
        <View style={[styles.infoRow, { borderColor: colors.border }]}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Gerado em</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {formatDate(document.meta.generated_at)}
          </Text>
        </View>
        <View style={[styles.infoRow, { borderColor: colors.border }]}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Acidentes considerados</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {document.meta.total_acidentes_considerados.toLocaleString('pt-BR')}
          </Text>
        </View>
        <View style={[styles.infoRow, { borderColor: colors.border }]}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Hotspots gerados</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {document.meta.total_hotspots.toLocaleString('pt-BR')}
          </Text>
        </View>
        <View style={[styles.infoRow, { borderColor: colors.border }]}>
          <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Origem no aparelho</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {source === 'cache' ? 'Cache atualizado' : 'Dados embarcados'}
          </Text>
        </View>
        <Pressable onPress={() => Linking.openURL(PRF_URL)} accessibilityRole="link">
          <Text style={[styles.link, { color: colors.primary }]}>Abrir portal de dados abertos da PRF</Text>
        </Pressable>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Como o score é calculado</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Cada acidente recebe pontos inspirados na Unidade Padrão de Severidade (UPS) da PRF:
        </Text>
        <View style={styles.bullets}>
          <Text style={[styles.bullet, { color: colors.textMuted }]}>• 1 ponto: acidente sem vítimas.</Text>
          <Text style={[styles.bullet, { color: colors.textMuted }]}>• 4 pontos: acidente com feridos.</Text>
          <Text style={[styles.bullet, { color: colors.textMuted }]}>• 13 pontos: acidente com mortos.</Text>
        </View>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Os acidentes são agrupados por rodovia (UF + BR) em trechos de até 300 m, com no mínimo 5
          acidentes por trecho. O score do hotspot é a soma dos pontos dos acidentes do trecho. Os
          níveis usam percentis do score entre todos os hotspots: crítico (p95), alto (p80), médio
          (p50) e baixo (abaixo de p50).
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          O raio exibido é o percentil 90 das distâncias dos acidentes ao centro do trecho, limitado
          entre 100 e 500 metros. Como a coordenada da PRF é georreferenciada ao trecho da rodovia
          (e não ao GPS do acidente), vários acidentes caem no mesmo ponto: o km mostrado é o do
          grupo dominante de registros.
        </Text>
      </View>

      {hasInfra ? (
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Infraestrutura no entorno</Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            Quando disponível, os detalhes do trecho mostram a contagem de semáforos, faixas de
            pedestre, redutores de velocidade e câmeras num raio de 100 m além do hotspot. Os dados
            vêm do OpenStreetMap, que é colaborativo e pode estar incompleto ou desatualizado — a
            ausência de um item não prova que ele não existe na via.
          </Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            © colaboradores do OpenStreetMap, disponibilizado sob a licença ODbL.
          </Text>
        </View>
      ) : null}

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Trânsito em tempo real</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Além do histórico da PRF, o app consulta os incidentes de trânsito do TomTom para a área
          visível no mapa e para um raio de 30 km ao redor de você. Entram acidentes, interdições e
          veículos quebrados; os alertas em primeiro plano cobrem acidentes e interdições.
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Os dados são atualizados enquanto o app está aberto, no intervalo escolhido em
          Configurações (padrão de 15 minutos). O plano gratuito do TomTom permite 2.500 consultas
          por mês; o app conta o uso no aparelho e evita consultas desnecessárias com cache.
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Para buscar os incidentes, o app envia ao TomTom apenas a área geográfica consultada —
          não envia sua identidade nem grava um histórico de posições. A chave da API fica embutida
          no aplicativo; por isso, restrinja o uso dela no painel do TomTom.
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Incidentes: © TomTom. Dados em tempo real podem estar incompletos ou atrasados.
        </Text>
      </View>

      <View style={[styles.warning, { backgroundColor: colors.surface, borderColor: colors.danger }]}>
        <Text style={[styles.warningTitle, { color: colors.danger }]}>Aviso importante</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Informação baseada em dados históricos; não substitui a atenção ao dirigir nem a
          sinalização da via. Não use o celular enquanto dirige.
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          Dados históricos não preveem acidentes futuros. As coordenadas da PRF podem ter imprecisão
          e 2026 é um ano parcial.
        </Text>
      </View>

      <Text style={[styles.footer, { color: colors.textMuted }]}>
        RiskRadar 1.0.0 · React Native + Expo · dados processados com Python
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  section: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
  },
  bullets: {
    gap: 3,
  },
  bullet: {
    fontSize: 13,
    lineHeight: 19,
  },
  infoRow: {
    gap: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  infoLabel: {
    fontSize: 11,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  link: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  warning: {
    borderWidth: 1.5,
    borderRadius: radius.lg,
    padding: 16,
    gap: 8,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  footer: {
    fontSize: 11,
    textAlign: 'center',
    paddingTop: 4,
  },
});
