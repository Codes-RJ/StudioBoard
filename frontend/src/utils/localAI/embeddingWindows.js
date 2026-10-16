// Preserve every character while staying below the encoder's token window.
// The tokenizer, rather than a character estimate, determines each boundary.
export const textWindows = (text, encode, maxTokens = 192) => {
  const pending = [text]; const windows = [];
  while (pending.length) {
    const piece = pending.pop(); const count = encode(piece, { add_special_tokens: false }).length;
    if (count <= maxTokens) { windows.push({ text: piece, weight: Math.max(1, count) }); continue; }
    let middle = Math.floor(piece.length / 2);
    if (middle > 0 && /[\uD800-\uDBFF]/.test(piece[middle - 1])) middle -= 1;
    if (!middle) throw new Error('A character exceeds the embedding tokenizer window.');
    pending.push(piece.slice(middle), piece.slice(0, middle));
  }
  return windows;
};

export const embedTextWindows = async (texts, embedder) => {
  const results = [];
  for (const text of texts) {
    const windows = textWindows(text, embedder.tokenizer.encode.bind(embedder.tokenizer));
    let combined = null;
    for (let offset = 0; offset < windows.length; offset += 8) {
      const batch = windows.slice(offset, offset + 8);
      const vectors = (await embedder(batch.map((part) => part.text), { pooling: 'mean', normalize: true })).tolist();
      vectors.forEach((vector, index) => {
        combined ||= vector.map(() => 0);
        vector.forEach((value, dimension) => { combined[dimension] += value * batch[index].weight; });
      });
    }
    const norm = Math.hypot(...combined);
    if (!Number.isFinite(norm) || !norm) throw new Error('The embedding model returned an invalid vector.');
    results.push(combined.map((value) => value / norm));
  }
  return results;
};
