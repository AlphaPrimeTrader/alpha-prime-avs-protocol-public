import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { phase3BTestnetRelayPlugin } from './test-harness/phase3b-relay';

const rawPort = process.env.PORT ?? '5173';

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '');
  const phase3bFactory = env.VITE_PHASE3B_FACTORY_ADDRESS;
  const phase3bImplementation = env.VITE_PHASE3B_INITIAL_IMPLEMENTATION_ADDRESS;
  const phase3bNextImplementation = env.VITE_PHASE3B_NEXT_IMPLEMENTATION_ADDRESS;
  const phase3bTestReceiver = env.VITE_PHASE3B_TEST_RECEIVER_ADDRESS;
  const liveRelayEnabled = env.PHASE3B_LIVE_RELAY_ENABLED === '1';
  if (!phase3bFactory || !phase3bImplementation || !phase3bNextImplementation || !phase3bTestReceiver) {
    throw new Error('Phase 3B Factory, implementation, and TestReceiver addresses are required.');
  }
  return {
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    liveRelayEnabled && phase3BTestnetRelayPlugin({
        factory: phase3bFactory,
        implementation: phase3bImplementation,
        nextImplementation: phase3bNextImplementation,
        testReceiver: phase3bTestReceiver,
      }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: liveRelayEnabled ? '127.0.0.1' : '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: liveRelayEnabled ? '127.0.0.1' : '0.0.0.0',
    allowedHosts: true,
  },
  };
});
