import { levelLabels, levelOrder } from '@/theme';
import type { Hotspot, Level } from '@/types/hotspots';

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function formatKmRange(hotspot: Pick<Hotspot, 'km_min' | 'km_max'>): string {
  const min = Number(hotspot.km_min).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const max = Number(hotspot.km_max).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (hotspot.km_max <= hotspot.km_min) return `km ${min}`;
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
