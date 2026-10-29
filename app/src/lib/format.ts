import { levelLabels, levelOrder } from '@/theme';
import type { Hotspot, Level } from '@/types/hotspots';

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/**
 * Trecho de km do hotspot.
 *
 * O km reportado pela PRF é georreferenciado ao trecho da rodovia (e às vezes
 * com numeração inconsistente), então uma faixa muito larga não descreve o
 * ponto: nesses casos mostramos o km de referência (mediana).
 */
export function formatKmRange(
  hotspot: Pick<Hotspot, 'km_min' | 'km_max'> & Partial<Pick<Hotspot, 'km_mediana'>>
): string {
  const min = Number(hotspot.km_min).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const max = Number(hotspot.km_max).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (hotspot.km_max <= hotspot.km_min) return `km ${min}`;
  if (hotspot.km_max - hotspot.km_min > 5) {
    const reference = Number(hotspot.km_mediana ?? hotspot.km_min).toLocaleString('pt-BR', {
      maximumFractionDigits: 1,
    });
    return `km ~${reference}`;
  }
  return `km ${min}–${max}`;
}

export function hotspotTitle(hotspot: Hotspot): string {
  const municipality = hotspot.municipio || hotspot.uf;
  return `BR-${hotspot.br}/${hotspot.uf} · ${municipality} · ${formatKmRange(hotspot)}`;
}

export function levelLabel(level: Level): string {
  return levelLabels[level] ?? level;
}

export function levelRank(level: Level): number {
  return levelOrder.indexOf(level);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Tempo relativo curto para "atualizado há X" e para incidentes recentes.
 * Aceita timestamp em ms ou data ISO.
 */
export function formatRelativeTime(input: number | string, now = Date.now()): string {
  const time = typeof input === 'number' ? input : new Date(input).getTime();
  if (!Number.isFinite(time)) return '—';
  const diff = Math.max(0, now - time);
  if (diff < 60_000) return 'agora';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} d`;
  return new Date(time).toLocaleDateString('pt-BR');
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

export function faseDiaOrdered(faseDia: Record<string, number>): { label: string; value: number }[] {
  const preferred = ['Pleno Dia', 'Plena Noite', 'Anoitecer', 'Amanhecer'];
  const keys = Object.keys(faseDia);
  const ordered = [
    ...preferred.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !preferred.includes(key)).sort(),
  ];
  return ordered.map((key) => ({ label: key, value: faseDia[key] ?? 0 }));
}

export function porAnoOrdered(porAno: Record<string, number>): { label: string; value: number }[] {
  return Object.keys(porAno)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => ({ label: key, value: porAno[key] ?? 0 }));
}
