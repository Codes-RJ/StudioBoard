// @ts-check
/** @typedef {{ n: bigint, d: bigint }} ExactValue */
/** @typedef {'sum' | 'average' | 'median' | 'min' | 'max' | 'count' | 'weighted_average'} ExactAggregation */
// Exact decimal inputs become reduced rational BigInts; transport uses strings.
// No Number conversion, presentation rounding, or locale/currency guessing.
/** @param {bigint} value */
const abs = (value) => value < 0n ? -value : value;
/** @param {bigint} a @param {bigint} b */
const gcd = (a, b) => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a || 1n; };
/** @param {bigint} n @param {bigint} [d] @returns {ExactValue} */
const fraction = (n, d = 1n) => {
  if (!d) throw new Error('A zero denominator has no exact value.');
  if (d < 0n) { n = -n; d = -d; }
  const factor = gcd(n, d); n /= factor; d /= factor;
  if (String(abs(n)).length > 1024 || String(d).length > 1024) throw new Error('Exact arithmetic exceeds the 1,024-digit working limit.');
  return { n, d };
};
/** @param {unknown} value @returns {ExactValue | null} */
export const parseExactDecimal = (value) => {
  if (value == null || String(value).trim() === '') return null;
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('This number already lost integer precision. Re-import the original value as text.');
  const text = String(value).trim();
  if (text.length > 512) throw new Error('An exact decimal input exceeds 512 characters.');
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d{1,3}))?$/.exec(text);
  if (!match) throw new Error('Exact measures require plain decimal text; review currency, percent and unit formatting explicitly.');
  const scale = (match[3]?.length || 0) - Number(match[4] || 0);
  if (Math.abs(scale) > 256) throw new Error('An exact decimal scale exceeds 256 places.');
  const coefficient = BigInt(`${match[1] === '-' ? '-' : ''}${match[2]}${match[3] || ''}`);
  return scale < 0 ? fraction(coefficient * 10n ** BigInt(-scale)) : fraction(coefficient, 10n ** BigInt(scale));
};
/** @param {ExactValue} a @param {ExactValue} b */
export const compareExact = (a, b) => { const delta = a.n * b.d - b.n * a.d; return delta < 0n ? -1 : delta > 0n ? 1 : 0; };
/** @param {ExactValue} a @param {ExactValue} b */
const add = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
/** @param {ExactValue} a @param {ExactValue} b */
const multiply = (a, b) => fraction(a.n * b.n, a.d * b.d);
/** @param {ExactValue} value @returns {string} */
export const formatExact = (value) => {
  let denominator = value.d; let twos = 0; let fives = 0;
  while (denominator % 2n === 0n) { denominator /= 2n; twos++; }
  while (denominator % 5n === 0n) { denominator /= 5n; fives++; }
  if (denominator !== 1n) return `${value.n}/${value.d}`;
  const places = Math.max(twos, fives);
  const digits = String(abs(value.n) * 2n ** BigInt(places - twos) * 5n ** BigInt(places - fives)).padStart(places + 1, '0');
  const text = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/0+$/, '').replace(/\.$/, '') : digits;
  return `${value.n < 0n ? '-' : ''}${text}`;
};
/** @param {ExactAggregation} aggregation */
export const createExactMetric = (aggregation) => {
  let count = 0; let sum = fraction(0n); let denominator = fraction(0n);
  /** @type {ExactValue | null} */ let minimum = null;
  /** @type {ExactValue | null} */ let maximum = null;
  /** @type {ExactValue[]} */ const values = [];
  return {
    /** @param {unknown} value @param {unknown} [weight] */
    consume: (value, weight) => {
      const number = parseExactDecimal(value); if (!number) return false;
      const coefficient = aggregation === 'weighted_average' ? parseExactDecimal(weight) : null;
      if (aggregation === 'weighted_average' && (!coefficient || coefficient.n < 0n)) return false;
      count++;
      if (['sum', 'average'].includes(aggregation)) sum = add(sum, number);
      if (aggregation === 'weighted_average' && coefficient) { sum = add(sum, multiply(number, coefficient)); denominator = add(denominator, coefficient); }
      if (!minimum || compareExact(number, minimum) < 0) minimum = number;
      if (!maximum || compareExact(number, maximum) > 0) maximum = number;
      if (aggregation === 'median') { if (values.length >= 250_000) throw new Error('Exact median exceeds 250,000 retained values.'); values.push(number); }
      return true;
    },
    result: () => {
      if (!count) return null;
      if (aggregation === 'count') return fraction(BigInt(count));
      if (aggregation === 'sum') return sum;
      if (aggregation === 'average') return fraction(sum.n, sum.d * BigInt(count));
      if (aggregation === 'weighted_average') return denominator.n ? fraction(sum.n * denominator.d, sum.d * denominator.n) : null;
      if (aggregation === 'min') return minimum;
      if (aggregation === 'max') return maximum;
      values.sort(compareExact); const middle = Math.floor(count / 2);
      return count % 2 ? values[middle] : fraction(add(values[middle - 1], values[middle]).n, add(values[middle - 1], values[middle]).d * 2n);
    },
  };
};
