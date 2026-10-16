// Vitest setup: registers Testing Library matchers when available.
import '@testing-library/jest-dom';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Visibility/focus inspection in jsdom can exceed Testing Library's 1 s default
// on Windows. Keep assertions unchanged and allow the asynchronous UI to settle.
configure({ asyncUtilTimeout: process.platform === 'win32' ? 5_000 : 1_000 });

afterEach(() => cleanup());
