import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'child_process'

const commitHash = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
})();

export default defineConfig({
  plugins: [vue()],
  define: {
    __BUILD__: JSON.stringify(commitHash),
  },
})
