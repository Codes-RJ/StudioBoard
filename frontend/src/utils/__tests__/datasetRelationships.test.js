import { describe, expect, it } from 'vitest';
import { discoverDatasetRelationships, relationshipNeedsReview, reviewDatasetRelationship } from '../datasetRelationships';

const dataset = (id, sourcePath, column, rows, updatedAt = 'rev1') => ({
  id, sourcePath, updatedAt, columns: [{ name: column }], rawRows: rows
});

describe('local dataset relationship discovery', () => {
  it('reviews complete composite tuples, preserving boundaries and leading-zero identifiers', () => {
    const left = { id: 'left', columns: ['key', 'part'], rawRows: [{ key: '001', part: 'A' }, { key: '1', part: 'A' }, { key: '001', part: null }] };
    const right = { id: 'right', columns: ['code', 'segment'], rawRows: [{ code: '001', segment: 'A' }, { code: '001', segment: 'B' }] };
    const args = { datasets: [left, right], leftDatasetId: 'left', rightDatasetId: 'right', leftColumns: ['key', 'part'], rightColumns: ['code', 'segment'] };
    expect(reviewDatasetRelationship(args)).toMatchObject({ manual: true, status: 'suggested', matchedDistinct: 1, innerJoinRows: 1, leftUnmatchedRows: 2, rightUnmatchedRows: 1, cardinality: 'one-to-one' });
    expect(() => reviewDatasetRelationship({ ...args, leftColumns: ['key', 'key'] })).toThrow('distinct');
    expect(() => reviewDatasetRelationship({ ...args, leftColumns: ['absent', 'part'] })).toThrow('chosen source');
  });
  it('estimates overlap, uniqueness, unmatched records, and left join expansion without returning values', () => {
    const left = dataset('left', 'customers.csv', 'Customer ID', [{ 'Customer ID': 'a' }, { 'Customer ID': 'b' }, { 'Customer ID': 'b' }]);
    const right = dataset('right', 'orders.csv', 'Customer ID', [{ 'Customer ID': 'b' }, { 'Customer ID': 'c' }]);
    const result = discoverDatasetRelationships([left, right]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: 'suggested', cardinality: 'many-to-one', leftUnique: false, rightUnique: true,
      matchedDistinct: 1, leftUnmatchedRows: 1, rightUnmatchedRows: 1,
      innerJoinRows: 2, leftJoinRows: 3, expansionRows: 0
    });
    expect(JSON.stringify(result)).not.toContain('Customer ID": "b');
    expect(left.rawRows).toHaveLength(3);
  });

  it('estimates expansion for a many-to-many match and suggests only keys with observed overlap', () => {
    const left = dataset('a', 'a.csv', 'Account Key', [{ 'Account Key': 'x' }, { 'Account Key': 'x' }]);
    const right = dataset('b', 'b.csv', 'Account Key', [{ 'Account Key': 'x' }, { 'Account Key': 'x' }]);
    expect(discoverDatasetRelationships([left, right])[0]).toMatchObject({ cardinality: 'many-to-many', innerJoinRows: 4, leftJoinRows: 4, expansionRows: 2 });
    expect(discoverDatasetRelationships([left, dataset('c', 'c.csv', 'Other', [{ Other: 'x' }])])).toEqual([]);
  });

  it('marks a stored relationship stale when either source revision changes', () => {
    const left = dataset('left', 'a.csv', 'Key', [{ Key: 1 }]);
    const right = dataset('right', 'b.csv', 'Key', [{ Key: 1 }]);
    const relationship = discoverDatasetRelationships([left, right])[0];
    expect(relationshipNeedsReview(relationship, [left, right])).toBe(false);
    expect(relationshipNeedsReview(relationship, [left, { ...right, updatedAt: 'rev2' }])).toBe(true);
  });

  it('keeps a high-overlap candidate found after many unrelated header matches', () => {
    const sources = Array.from({ length: 35 }, (_, index) => dataset(`unrelated_${index}`, `file${index}.csv`, 'Customer ID', [{ 'Customer ID': `unique-${index}` }]));
    sources.push(dataset('related-left', 'z-left.csv', 'Customer ID', [{ 'Customer ID': 'shared' }]));
    sources.push(dataset('related-right', 'z-right.csv', 'Customer ID', [{ 'Customer ID': 'shared' }]));
    const result = discoverDatasetRelationships(sources);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ leftDatasetId: 'related-left', rightDatasetId: 'related-right', matchedDistinct: 1, innerJoinRows: 1 });
  });
});
