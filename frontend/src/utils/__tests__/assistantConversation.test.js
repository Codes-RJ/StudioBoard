import { describe, expect, it } from 'vitest';
import { prepareAssistantMessage } from '../assistantConversation';
import { analyzeQueryWithData } from '../aiQueryEngine';

describe('local conversational messages', () => {
  it.each(['Hi', 'Hello!', 'Hey there', 'Good morning', 'Wassup?', "What's up!", 'Yo', 'Hiya', 'Cheers', 'Thank you', 'Thanks a lot!', 'Bye', 'Goodbye', 'See you later', 'Thanks, bye!'])('answers %s without inventing an analysis', (query) => {
    const { reply } = prepareAssistantMessage(query);
    expect(reply).toMatchObject({ intent: 'CONVERSATION', recommendedCard: null });
    expect(reply.directAnswer.length).toBeGreaterThan(10);
    expect(reply.interpretation).toBeUndefined();
    expect(reply.citations).toBeUndefined();
  });

  it.each([
    ['Hi, total Revenue by Region', 'total Revenue by Region'],
    ['Hello! Now average instead', 'Now average instead'],
    ['Thanks, what about West?', 'what about West?'],
    ['Total Revenue, thank you!', 'Total Revenue'],
    ['Hello, total Revenue, thanks!', 'total Revenue'],
    ['Wassup, total Revenue by Region', 'total Revenue by Region'],
  ])('keeps the analytical request in %s', (query, expected) => {
    expect(prepareAssistantMessage(query)).toEqual({ query: expected, reply: null });
  });

  it.each(['Total Thank You', 'Revenue by Hello', 'Count rows where Status is bye', 'Do not say hello; total Revenue', 'Revenue is high'])('does not consume substantive input %s', (query) => {
    expect(prepareAssistantMessage(query)).toEqual({ query, reply: null });
  });

  it('handles a greeting without a dataset and does not replace a subsequent analytical context', () => {
    expect(analyzeQueryWithData('Hello', null).intent).toBe('CONVERSATION');
    const dataset = { id: 'sales', revision: 'r1', columns: [{ name: 'Revenue', type: 'number' }], rawRows: [{ Revenue: 10 }, { Revenue: 30 }] };
    const first = analyzeQueryWithData('Total Revenue', dataset);
    expect(analyzeQueryWithData('Thank you', dataset).interpretation).toBeUndefined();
    const next = analyzeQueryWithData('Hi, now average instead', dataset, null, { context: first.interpretation });
    expect(next.directAnswer).toContain('20');
    expect(next.interpretation).toMatchObject({ metrics: ['Revenue'], aggregation: 'average' });
  });
});
