// Категорії, міста та дрібні утиліти, спільні для всього застосунку.
import { t, catName, getLang } from './i18n.js';

export const CATEGORIES = [
  { slug: 'jobs',        emoji: '💼' },
  { slug: 'housing',     emoji: '🏠' },
  { slug: 'services',    emoji: '🛠️' },
  { slug: 'transport',   emoji: '🚗' },
  { slug: 'goods',       emoji: '📦' },
  { slug: 'furniture',   emoji: '🛋️' },
  { slug: 'electronics', emoji: '📱' },
  { slug: 'kids',        emoji: '🧸' },
  { slug: 'beauty',      emoji: '💅' },
  { slug: 'documents',   emoji: '📄' },
  { slug: 'education',   emoji: '📚' },
  { slug: 'pets',        emoji: '🐾' },
  { slug: 'food',        emoji: '🍲' },
  { slug: 'free',        emoji: '🎁' },
  { slug: 'community',   emoji: '🤝' },
  { slug: 'other',       emoji: '✨' },
];

export const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c]));

export const CITIES = [
  'London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Edinburgh',
  'Liverpool', 'Bristol', 'Sheffield', 'Nottingham', 'Leicester', 'Coventry',
  'Cardiff', 'Newcastle', 'Reading', 'Wolverhampton', 'Bradford', 'Brighton',
  'Southampton', 'Northampton', 'Aberdeen', 'Belfast', 'Luton', 'Milton Keynes',
];

export function sorts() {
  return [
    { value: 'new', label: t('sort.new') },
    { value: 'cheap', label: t('sort.cheap') },
    { value: 'expensive', label: t('sort.expensive') },
    { value: 'popular', label: t('sort.popular') },
  ];
}

export function emojiFor(slug) {
  const c = CAT_MAP[slug];
  return c ? c.emoji : '✨';
}

export function catLabel(slug) {
  return `${emojiFor(slug)} ${catName(slug)}`;
}

export function formatPrice(listing) {
  if (listing.isFree || listing.price === 0) return t('common.free');
  if (listing.price == null) return t('common.negotiable');
  const n = Number(listing.price);
  const str = Number.isInteger(n) ? n.toString() : n.toFixed(2);
  return '£' + str.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function timeAgo(iso) {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return t('time.now');
  const m = Math.floor(s / 60);
  if (m < 60) return t('time.min', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('time.hour', { n: h });
  const days = Math.floor(h / 24);
  if (days === 1) return t('time.yesterday');
  if (days < 7) return t('time.days', { n: days });
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'uk-UA', { day: 'numeric', month: 'long' });
}

// Безпечне екранування тексту перед вставкою в HTML.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
