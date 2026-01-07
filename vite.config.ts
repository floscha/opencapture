import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(({ command, mode }) => {
    if (process.env.TARGET === 'main') {
        return {
            build: {
                outDir: 'dist/main',
                lib: {
                    entry: resolve(__dirname, 'src/main/index.ts'),
                    formats: ['cjs'],
                    fileName: () => 'index.js',
                },
                rollupOptions: {
                    external: ['electron'],
                },
                emptyOutDir: true,
            },
        };
    } else if (process.env.TARGET === 'preload') {
        return {
            build: {
                outDir: 'dist/preload',
                lib: {
                    entry: resolve(__dirname, 'src/preload/index.ts'),
                    formats: ['cjs'],
                    fileName: () => 'index.js',
                },
                rollupOptions: {
                    external: ['electron'],
                },
                emptyOutDir: true,
            },
        };
    }

    return {
        root: 'src/renderer',
        base: './',
        build: {
            outDir: '../../dist/renderer',
            emptyOutDir: true,
        },
        plugins: [react()],
        resolve: {
            alias: {
                '@': resolve(__dirname, 'src/renderer'),
            }
        }
    };
});
