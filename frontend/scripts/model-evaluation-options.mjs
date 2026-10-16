// A diagnostic sample must never overwrite a full collection report or pass
// the release gate. Keep all sources imported even when asking fewer questions.
export const selectEvaluationCases = (cases, argv) => {
  const ids = argv.filter((arg) => arg.startsWith('--case-ids'));
  const flags = argv.filter((arg) => arg.startsWith('--case-limit'));
  if (ids.length) {
    if (ids.length !== 1 || flags.length || !/^--case-ids=[a-z0-9-]+(?:,[a-z0-9-]+)*$/.test(ids[0])) throw new Error('Use one --case-ids=id,id diagnostic option, without --case-limit.');
    const requested = ids[0].slice('--case-ids='.length).split(',');
    if (new Set(requested).size !== requested.length || requested.some((id) => !cases.some((spec) => spec.id === id))) throw new Error('Diagnostic case IDs must be unique known cases.');
    return { selected: cases.filter((spec) => requested.includes(spec.id)), diagnostic: true };
  }
  if (!flags.length) return { selected: cases, diagnostic: false };
  if (flags.length !== 1 || !/^--case-limit=[1-9]\d*$/.test(flags[0])) throw new Error('Use one --case-limit=positive-integer diagnostic option.');
  const limit = Number(flags[0].split('=')[1]);
  if (!Number.isSafeInteger(limit) || limit > cases.length) throw new Error('Diagnostic case limit exceeds the evaluation suite.');
  return { selected: cases.slice(0, limit), diagnostic: true };
};
