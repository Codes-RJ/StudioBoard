import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    // Child-process workers can time out on supported Windows installations
    // with restrictive process policies. VM threads are fast and reliable
    // there; Linux CI keeps isolated fork workers.
    pool: process.platform === 'win32' ? 'vmThreads' : 'forks',
    fileParallelism: process.platform !== 'win32',
    testTimeout: process.platform === 'win32' ? 15_000 : 5_000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/audit-results/**',
      '**/.pytest_cache/**',
      '**/backend/.pytest_cache/**'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.config.js',
        '**/dist/**'
      ]
    },
    globals: true
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@components': path.resolve(import.meta.dirname, './src/components'),
      '@pages': path.resolve(import.meta.dirname, './src/pages'),
      '@hooks': path.resolve(import.meta.dirname, './src/hooks'),
      '@services': path.resolve(import.meta.dirname, './src/services'),
      '@utils': path.resolve(import.meta.dirname, './src/utils')
    }
  }
})
