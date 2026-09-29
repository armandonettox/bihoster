import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom simula o navegador pros testes de componentes React
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Restaura mocks e limpa a DOM entre testes, pra um teste nao vazar estado pro outro
    restoreMocks: true,
    clearMocks: true,
  },
})
