// @ts-check
/** @param {number} value @param {string} [operation] @returns {number} */
export const finiteResult = (value, operation = 'calculation') => {
  if (!Number.isFinite(value)) throw new Error(`Number range exceeded during ${operation}. Review the measure and units before calculating.`);
  return value;
};
/** @param {number} left @param {number} right */
export const addFinite = (left, right) => finiteResult(left + right, 'addition');
/** @param {number} left @param {number} right */
export const multiplyFinite = (left, right) => finiteResult(left * right, 'weighted multiplication');
/** @param {number[]} values @returns {number | null} */
export const meanFinite = (values) => {
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Number.isFinite(sum) ? sum / values.length : values.reduce((total, value) => addFinite(total, value / values.length), 0);
};
/** @param {number} left @param {number} right */
export const midpointFinite = (left, right) => Number.isFinite(left + right) ? (left + right) / 2 : finiteResult(left / 2 + right / 2, 'median');
