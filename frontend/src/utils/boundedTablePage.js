import { parseExactDecimal, compareExact } from './exactDecimal';
// Exact stable top-k selection. A page never retains the entire filtered table.
export const sortedTablePage = (rows, { page, limit, sort, order = 'asc', matches }) => {
  const end = page * limit;
  if (!Number.isSafeInteger(end) || end > 50_000) throw new Error('Sorted paging retains at most 50,000 positions. Narrow the filters or use an unsorted page.');
  const compare = (a, b) => {
    const left = a.row?.[sort]; const right = b.row?.[sort];
    if (left == null || right == null) return (left == null) - (right == null) || a.index - b.index;
    const x = Number(left); const y = Number(right);
    let value;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      try { const exactLeft = parseExactDecimal(left); const exactRight = parseExactDecimal(right); value = exactLeft && exactRight ? compareExact(exactLeft, exactRight) : x - y; }
      catch { value = x - y; }
    } else value = String(left).localeCompare(String(right));
    return (order === 'desc' ? -value : value) || a.index - b.index;
  };
  const heap = []; let total = 0;
  const down = () => {
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) > 0) child++;
      if (compare(heap[index], heap[child]) >= 0) break;
      [heap[index], heap[child]] = [heap[child], heap[index]]; index = child;
    }
  };
  for (const [index, row] of rows.entries()) {
    if (!matches(row)) continue;
    total++;
    const entry = { row, index };
    if (heap.length < end) {
      heap.push(entry); let position = heap.length - 1;
      while (position > 0) {
        const parent = Math.floor((position - 1) / 2);
        if (compare(heap[parent], heap[position]) >= 0) break;
        [heap[parent], heap[position]] = [heap[position], heap[parent]]; position = parent;
      }
    } else if (compare(entry, heap[0]) < 0) { heap[0] = entry; down(); }
  }
  heap.sort(compare);
  return { data: heap.slice((page - 1) * limit).map(({ row }) => row), total, page, limit };
};
