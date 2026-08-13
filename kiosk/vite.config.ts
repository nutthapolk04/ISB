import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'fs'
import { versionCodeFromSemver } from './scripts/version-code.mjs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

/** Same integer as Android versionCode — identical across devices for a given package.json version. */
const versionCode = String(versionCodeFromSemver(version))

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(versionCode),
  },
})
