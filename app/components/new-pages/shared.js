export function areaLabel(area) {
  return [area?.name, area?.region, area?.country].filter(Boolean).join(', ');
}
export function areaKey(area) {
  return areaLabel(area).trim().toLocaleLowerCase();
}
export function contextKey(context) {
  return JSON.stringify([areaKey(context?.area), [...(context?.services || [])].map(value => value.trim().toLowerCase()).sort(), (context?.facts || '').trim()]);
}
export function safeLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
export function displayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}
export const fieldClass = 'w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
