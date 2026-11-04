import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'vite';

const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
await build({
  configFile: false,
  logLevel: 'info',
  build: {
    target: 'node24',
    outDir: resolve('dist/operator'),
    emptyOutDir: true,
    lib: {
      entry: resolve('scripts/workspace-auth-admin.ts'),
      formats: ['es'],
      fileName: () => 'workspace-auth-admin.mjs',
    },
    rollupOptions: {
      external: id => builtins.has(id),
      output: { format: 'es' },
    },
  },
});
