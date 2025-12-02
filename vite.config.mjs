import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

console.log('Loading Vite Config...');

export default defineConfig({
    plugins: [
        basicSsl()
    ],
    server: {
        host: true,
        https: true
    }
});
