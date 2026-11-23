// Icons from https://selfh.st/icons/ via jsDelivr (lowercase slug, no "sh-" prefix required).
const CDN = 'https://cdn.jsdelivr.net/gh/selfhst/icons@main';

export const selfhIconUrl = (
  icon: string | null | undefined,
  format: 'webp' | 'png' | 'svg' = 'webp',
): string | null => {
  if (!icon?.trim()) return null;
  const raw = icon.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const slug = raw.replace(/^sh[-_]/i, '').toLowerCase();
  if (!slug) return null;
  return `${CDN}/${format}/${slug}.${format}`;
};