// Підписи й опції додаткових характеристик (UA/EN).
// Структуру схеми (які поля в якій категорії) сервер віддає на /api/meta/attributes.
// Тут — лише людські назви ключів та значень.
import { getLang } from './i18n.js';

const L = {
  // Назви полів
  field: {
    rooms: { uk: 'Кімнат', en: 'Rooms' },
    furnished: { uk: 'Меблювання', en: 'Furnishing' },
    billsIncluded: { uk: 'Рахунки включені', en: 'Bills included' },
    period: { uk: 'Період оплати', en: 'Payment period' },
    employment: { uk: 'Зайнятість', en: 'Employment' },
    schedule: { uk: 'Графік', en: 'Schedule' },
    payPeriod: { uk: 'Оплата за', en: 'Pay per' },
    remote: { uk: 'Віддалено', en: 'Remote' },
    make: { uk: 'Марка', en: 'Make' },
    year: { uk: 'Рік', en: 'Year' },
    mileage: { uk: 'Пробіг, миль', en: 'Mileage, mi' },
    fuel: { uk: 'Паливо', en: 'Fuel' },
    condition: { uk: 'Стан', en: 'Condition' },
    warranty: { uk: 'Гарантія', en: 'Warranty' },
    delivery: { uk: 'Доставка', en: 'Delivery' },
  },
  // Назви значень select
  value: {
    studio: { uk: 'Студія', en: 'Studio' },
    '1': { uk: '1', en: '1' }, '2': { uk: '2', en: '2' }, '3': { uk: '3', en: '3' }, '4+': { uk: '4+', en: '4+' },
    furnished: { uk: 'З меблями', en: 'Furnished' },
    unfurnished: { uk: 'Без меблів', en: 'Unfurnished' },
    partly: { uk: 'Частково', en: 'Partly furnished' },
    monthly: { uk: 'на місяць', en: 'per month' },
    weekly: { uk: 'на тиждень', en: 'per week' },
    daily: { uk: 'на добу', en: 'per day' },
    fulltime: { uk: 'Повна', en: 'Full-time' },
    parttime: { uk: 'Часткова', en: 'Part-time' },
    temporary: { uk: 'Тимчасова', en: 'Temporary' },
    oneoff: { uk: 'Разова', en: 'One-off' },
    day: { uk: 'День', en: 'Day' },
    night: { uk: 'Ніч', en: 'Night' },
    shift: { uk: 'Зміни', en: 'Shifts' },
    flexible: { uk: 'Гнучкий', en: 'Flexible' },
    hour: { uk: 'годину', en: 'hour' },
    week: { uk: 'тиждень', en: 'week' },
    month: { uk: 'місяць', en: 'month' },
    petrol: { uk: 'Бензин', en: 'Petrol' },
    diesel: { uk: 'Дизель', en: 'Diesel' },
    hybrid: { uk: 'Гібрид', en: 'Hybrid' },
    electric: { uk: 'Електро', en: 'Electric' },
    other: { uk: 'Інше', en: 'Other' },
    new: { uk: 'Новий', en: 'New' },
    likenew: { uk: 'Як новий', en: 'Like new' },
    good: { uk: 'Гарний', en: 'Good' },
    used: { uk: 'Вживаний', en: 'Used' },
    parts: { uk: 'На запчастини', en: 'For parts' },
  },
};

export function attrFieldLabel(key) {
  const e = L.field[key];
  return e ? e[getLang()] : key;
}

export function attrValueLabel(val) {
  const e = L.value[String(val)];
  if (e) return e[getLang()];
  if (val === true) return getLang() === 'en' ? 'Yes' : 'Так';
  return String(val);
}

// Зведений рядок характеристик для картки/деталей: "2 кімн. · З меблями · Рахунки включені".
export function attrSummary(category, attributes) {
  if (!attributes) return [];
  const out = [];
  for (const [k, v] of Object.entries(attributes)) {
    if (v === false || v == null || v === '') continue;
    if (v === true) out.push(attrFieldLabel(k));
    else out.push(attrValueLabel(v));
  }
  return out;
}
