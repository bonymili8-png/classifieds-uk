// Категорії, міста та дрібні утиліти, спільні для всього застосунку.

export const CATEGORIES = [
  { slug: 'jobs',        name: 'Робота',            emoji: '💼' },
  { slug: 'housing',     name: 'Житло / Оренда',    emoji: '🏠' },
  { slug: 'services',    name: 'Послуги',           emoji: '🛠️' },
  { slug: 'transport',   name: 'Транспорт / Підвіз', emoji: '🚗' },
  { slug: 'goods',       name: 'Речі',              emoji: '📦' },
  { slug: 'furniture',   name: 'Меблі та побут',    emoji: '🛋️' },
  { slug: 'electronics', name: 'Електроніка',       emoji: '📱' },
  { slug: 'kids',        name: 'Дитячі товари',     emoji: '🧸' },
  { slug: 'beauty',      name: "Краса і здоров'я",  emoji: '💅' },
  { slug: 'documents',   name: 'Документи / Переклади', emoji: '📄' },
  { slug: 'education',   name: 'Навчання',          emoji: '📚' },
  { slug: 'pets',        name: 'Тварини',           emoji: '🐾' },
  { slug: 'food',        name: 'Їжа / Кулінарія',   emoji: '🍲' },
  { slug: 'free',        name: 'Безкоштовно',       emoji: '🎁' },
  { slug: 'community',   name: 'Спільнота',         emoji: '🤝' },
  { slug: 'other',       name: 'Інше',              emoji: '✨' },
];

export const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c]));

export const CITIES = [
  'London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Edinburgh',
  'Liverpool', 'Bristol', 'Sheffield', 'Nottingham', 'Leicester', 'Coventry',
  'Cardiff', 'Newcastle', 'Reading', 'Wolverhampton', 'Bradford', 'Brighton',
  'Southampton', 'Northampton', 'Aberdeen', 'Belfast', 'Luton', 'Milton Keynes',
];

export const SORTS = [
  { value: 'new',       label: 'Спочатку нові' },
  { value: 'cheap',     label: 'Дешевші спершу' },
  { value: 'expensive', label: 'Дорожчі спершу' },
  { value: 'popular',   label: 'Популярні' },
];

export function catLabel(slug) {
  const c = CAT_MAP[slug];
  return c ? `${c.emoji} ${c.name}` : 'Інше';
}

export function formatPrice(listing) {
  if (listing.isFree || listing.price === 0) return 'Безкоштовно';
  if (listing.price == null) return 'Договірна';
  const n = Number(listing.price);
  const str = Number.isInteger(n) ? n.toString() : n.toFixed(2);
  return '£' + str.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function timeAgo(iso) {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'щойно';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} хв тому`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} год тому`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'вчора';
  if (days < 7) return `${days} дн. тому`;
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

// Безпечне екранування тексту перед вставкою в HTML.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
