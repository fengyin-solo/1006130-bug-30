import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 纯前端应用：没有后端，数据全部走 src/api/local-service.ts。
// 环境变量只有仓库根 .env 这一份（本地 vite 与容器构建共用），所以 envDir 指向上一级。
export default defineConfig(({ mode }) => {
  const rootDir = fileURLToPath(new URL('.', import.meta.url))
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '')

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: env.WEB_HOST || '0.0.0.0',
      port: Number(env.WEB_PORT || 5173),
      // 关掉自动打开页面：起服务时只打印地址，不拉起浏览器
      open: false,
      strictPort: true,
    },
    preview: {
      host: env.WEB_HOST || '0.0.0.0',
      port: Number(env.WEB_PORT || 5173),
    },
    envDir: fileURLToPath(new URL('..', import.meta.url)),
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
