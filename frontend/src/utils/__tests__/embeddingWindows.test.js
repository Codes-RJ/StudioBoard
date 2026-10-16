import { describe, it, expect, vi } from 'vitest';
import { textWindows, embedTextWindows } from '../localAI/embeddingWindows';

describe('embedding token windows', () => {
  it('preserves dense Unicode text and complete tail content within the token limit', () => {
    const text = '密集数据🙂'.repeat(150) + 'TAIL_FACT';
    const encode = (value) => Array.from(value).flatMap((char) => [char, char]);
    const windows = textWindows(text, encode);
    expect(windows.map((part) => part.text).join('')).toBe(text);
    expect(windows.every((part) => encode(part.text).length <= 192)).toBe(true);
    expect(windows.at(-1).text).toContain('TAIL_FACT');
  });
  it('embeds every window and returns a finite normalized pooled vector', async () => {
    const seen = [];
    const embedder = vi.fn(async (texts) => { seen.push(...texts); return { tolist: () => texts.map(() => [3 / 5, 4 / 5]) }; });
    embedder.tokenizer = { encode: (value) => Array.from(value) };
    const text = 'x'.repeat(900) + 'last';
    const [vector] = await embedTextWindows([text], embedder);
    expect(seen.join('')).toBe(text);
    expect(vector[0]).toBeCloseTo(0.6); expect(vector[1]).toBeCloseTo(0.8);
    expect(Math.hypot(...vector)).toBeCloseTo(1);
  });
});
