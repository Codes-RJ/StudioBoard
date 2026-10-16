import { describe, expect, it, vi } from 'vitest';
import { generateToolAction } from '../localAI/generation';

const messages = [{ role: 'system', content: 'Use reviewed tables.' }, { role: 'user', content: 'Sum Amount.' }];
const context = { selectedId: 'sales', allowFinal: false, sourceSchemas: [{ id: 'sales', fields: ['Amount', 'Region'] }] };
const reply = (value) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });

describe('staged local action generation', () => {
  it('selects a prepared reviewed plan with one model call, without generating source identities or tool arguments', async () => {
    const complete = vi.fn().mockResolvedValue(reply({ plan: 'p1' }));
    const args = { sourceId: 'sales', edgeIds: ['approved-edge'], metric: 'sales::Amount', dimension: 'zones::Zone', aggregation: 'sum' };
    const output = JSON.parse(await generateToolAction(complete, messages, { ...context, question: 'Sum Amount by Zone', preparedPlans: [
      { id: 'p1', name: 'graph_calculate', args, description: 'Sum Amount from sales by Zone through the approved relationship' }
    ] }));
    expect(output).toMatchObject({ name: 'graph_calculate', args, completion: 'answer', planningRoute: 'model-selected-candidate' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].messages[1].content).not.toContain('sales::Amount');
  });
  it.each([{ plan: 'invented' }, { plan: 'p1', args: { sourceId: 'other' } }])('rejects unknown plans and argument injection: %j', async (choice) => {
    const complete = vi.fn().mockResolvedValue(reply(choice));
    await expect(generateToolAction(complete, messages, { ...context, question: 'Sum Amount', preparedPlans: [
      { id: 'p1', name: 'calculate', args: { metric: 'Amount', aggregation: 'sum' }, description: 'Sum Amount' }
    ] })).rejects.toThrow(/unavailable|Invalid prepared/);
  });
  it('reports separate stage timing and runtime usage without copying prompts or generated text', async () => {
    const diagnostic = vi.fn();
    const complete = vi.fn().mockResolvedValueOnce({ ...reply({ action: 'calculate', then: 'answer' }), usage: { prompt_tokens: 12, completion_tokens: 8 } })
      .mockResolvedValueOnce(reply({ type: 'tool', name: 'calculate', args: { metric: 'Amount', aggregation: 'sum' } }));
    await generateToolAction(complete, messages, context, { onDiagnostic: diagnostic });
    expect(diagnostic.mock.calls.map(([event]) => [event.stage, event.phase])).toEqual([
      ['action-selection', 'start'], ['action-selection', 'complete'], ['argument-generation', 'start'], ['argument-generation', 'complete']
    ]);
    expect(diagnostic.mock.calls[1][0]).toMatchObject({ usage: { prompt_tokens: 12, completion_tokens: 8 }, elapsedMs: expect.any(Number) });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('Amount');
  });
  it('separates tool selection from arguments and exposes the exact selected contract without changing history', async () => {
    const complete = vi.fn().mockResolvedValueOnce(reply({ action: 'calculate', then: 'answer' }))
      .mockResolvedValueOnce(reply({ type: 'tool', name: 'calculate', args: { metric: 'Amount', aggregation: 'sum' } }));
    const output = JSON.parse(await generateToolAction(complete, messages, context));
    expect(output.args.metric).toBe('Amount'); expect(complete).toHaveBeenCalledTimes(2);
    expect(output.completion).toBe('answer');
    const first = complete.mock.calls[0][0]; const second = complete.mock.calls[1][0];
    expect(JSON.parse(first.response_format.schema).properties.action.enum).not.toContain('final');
    const schema = JSON.parse(second.response_format.schema);
    expect(schema.properties.name.const).toBe('calculate');
    expect(schema.properties.args.properties.metric.enum).toEqual(['Amount', 'Region', '__rows__']);
    expect(second.messages.at(-1).content).toContain(second.response_format.schema);
    expect(messages.at(-1).content).toBe('Sum Amount.');
  });
  it.each([{ action: 'final' }, { action: 'javascript' }, { action: 'calculate', code: 'unsafe' }, []])('rejects an unavailable or malformed route before requesting arguments: %j', async (route) => {
    const complete = vi.fn().mockResolvedValue(reply(route));
    await expect(generateToolAction(complete, messages, context)).rejects.toThrow(/unavailable|valid action/);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('rejects switching tool identity even if a runtime ignores its decoder schema', async () => {
    const complete = vi.fn().mockResolvedValueOnce(reply({ action: 'calculate', then: 'answer' }))
      .mockResolvedValueOnce(reply({ type: 'tool', name: 'retrieve', args: { query: 'Amount' } }));
    await expect(generateToolAction(complete, messages, context)).rejects.toThrow('changed its selected action');
  });
  it('maps the model-selected grouped route to the existing calculation tool', async () => {
    const complete = vi.fn().mockResolvedValueOnce(reply({ action: 'calculate_grouped', then: 'continue' }))
      .mockResolvedValueOnce(reply({ type: 'tool', name: 'calculate', args: { metric: 'Amount', dimension: 'Region', aggregation: 'sum' } }));
    expect(JSON.parse(await generateToolAction(complete, messages, context)).args.dimension).toBe('Region');
    expect(JSON.parse(complete.mock.calls[1][0].response_format.schema).properties.args.required).toContain('dimension');
  });
  it('propagates a native device failure without a hidden retry', async () => {
    const complete = vi.fn().mockResolvedValueOnce(reply({ action: 'calculate', then: 'answer' })).mockRejectedValueOnce(new Error('Device lost'));
    await expect(generateToolAction(complete, messages, context)).rejects.toThrow('Device lost');
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('rejects immutable context overflow before starting inference', async () => {
    const complete = vi.fn();
    await expect(generateToolAction(complete, [{ role: 'user', content: 'x'.repeat(18_000) }], context)).rejects.toThrow('context budget');
    expect(complete).not.toHaveBeenCalled();
  });
});
