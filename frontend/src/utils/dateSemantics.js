/** Date.parse also accepts identifiers such as customer-99; inference must not. */
export const isDateLikeValue = (value) => {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  const calendar = /^(?:\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:[T\s].*)?$/.test(text);
  const namedMonth = /^(?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(?:\d{1,2},?\s+)?\d{4}(?:\s.*)?$/i.test(text);
  if (!(calendar || namedMonth) || !Number.isFinite(Date.parse(text))) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
  return true;
};

export const dateGroupKey = (value, { dateKind, timeZone = 'UTC' } = {}) => {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!dateKind || dateKind === 'verbatim') return String(value);
  if (dateKind === 'date-only') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`)) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) throw new Error('Date-only measures require a valid YYYY-MM-DD calendar date.');
    return text;
  }
  if (dateKind !== 'instant-day' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) throw new Error('An instant needs an ISO timestamp with Z or an explicit offset.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(text));
  const part = (type) => parts.find((entry) => entry.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
