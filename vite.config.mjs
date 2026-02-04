import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

console.log('Loading Vite Config...');

export default defineConfig(({ command }) => {
    const isDev = command === 'serve';
    return {
        plugins: [
            isDev ? basicSsl() : null
        ],
        server: {
            host: true,
            https: true
        },
        build: {
            outDir: 'dist',
            emptyOutDir: true
        }
    };
});
