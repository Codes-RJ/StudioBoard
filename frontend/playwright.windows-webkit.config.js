import config from './playwright.config.js';

// The Windows WebKit port stalls in recorded public-page transitions on this
// machine. Keep the ordinary suite unchanged; this explicit profile exercises
// the same assertions without video/trace capture. Retain failures from the
// ordinary profile separately when diagnosing the Windows runner.
// These are functional checks with Windows timing allowances, not a latency
// benchmark or evidence of physical Safari/mobile performance.
export default {
  ...config,
  timeout: 90_000,
  expect: { ...config.expect, timeout: 15_000 },
  projects: config.projects.filter(({ name }) => name === 'webkit'),
  use: { ...config.use, trace: 'off', video: 'off' }
};
