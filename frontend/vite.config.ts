import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 纯前端应用：没有后端，数据全部走 src/api/local-service.ts。
// 环境变量与构建参数只认仓库根目录那一份 .env（本地 / 容器 / 流水线同源）：
// envDir 指到根目录，HTML 的 %VITE_*% 与 loadEnv 都从那儿取，frontend 下不放 env 文件。
export default defineConfig(({ mode }) => {
  const rootDir = fileURLToPath(new URL('..', import.meta.url))
  const env = loadEnv(mode, rootDir, '')
  const host = env.VITE_DEV_HOST || env.FRONTEND_HOST || '127.0.0.1'
  const port = Number(env.FRONTEND_PORT || 5173)

  return {
    envDir: rootDir,
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host,
      port,
      // 关掉自动打开页面：起服务时只打印地址，不拉起浏览器
      open: false,
      strictPort: false,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
