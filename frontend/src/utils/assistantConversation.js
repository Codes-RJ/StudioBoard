// Small conversational replies are local UI behavior, not model-generated
// answers or calculation evidence. Only whole messages receive a canned reply.
const GREETING = '(?:hi|hiya|hello|hey(?: there)?|yo|sup|wassup|what[’\']?s up|good (?:morning|afternoon|evening))';
const THANKS = '(?:thanks(?: a lot| so much)?|thank you(?: very much| so much)?|cheers)';
const FAREWELL = '(?:bye(?: bye)?|goodbye|see you(?: later)?|take care)';
const classify = (text) => {
  if (new RegExp(`^${GREETING}$`, 'i').test(text)) return 'greeting';
  if (new RegExp(`^(?:${THANKS}[,!. ]+)?${FAREWELL}$`, 'i').test(text)) return 'farewell';
  if (new RegExp(`^${THANKS}$`, 'i').test(text)) return 'thanks';
  if (/^(?:help|what can you do|how can you help)(?: me)?$/i.test(text)) return 'help';
  return null;
};
const replies = {
  greeting: 'Hello! What would you like to explore in your data? You can ask for a total, compare groups, check missing values or look at a trend.',
  thanks: 'You’re welcome! We can continue with the same analysis or explore another question.',
  farewell: 'Goodbye! Your conversation stays here so you can continue later. Keep a workspace backup before clearing browser data.',
  help: 'I can summarize your data, calculate totals and averages, compare groups, check missing values, and suggest charts. Name the columns you want to explore. Evidence search also finds cited source text; optional semantic search needs an explicit model download.',
};

export const prepareAssistantMessage = (input) => {
  const original = String(input ?? '').trim();
  const kind = classify(original.replace(/[\s!?.,]+$/g, '').trim());
  if (kind) return { query: original, reply: { intent: 'CONVERSATION', conversation: kind,
    directAnswer: replies[kind], keyInsights: [], recommendedCard: null } };
  // Remove a polite opening, or a comma-separated closing, while keeping the
  // analytical request intact. Do not strip words inside column/filter names.
  const query = original
    .replace(new RegExp(`^(?:${GREETING}|${THANKS})[,!:;.\\s]+(?=\\S)`, 'i'), '')
    .replace(new RegExp(`[,;]\\s*${THANKS}[.!?\\s]*$`, 'i'), '')
    .trim();
  return { query: query || original, reply: null };
};
