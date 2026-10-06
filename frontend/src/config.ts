/**
 * 运行时配置的唯一出口：值由 Vite 在构建期从仓库根目录 .env 注入，
 * 本地 / 容器 / 流水线取的是同一份，页面与数据层不要再直接读 import.meta.env。
 */
export const appConfig = {
  appName: import.meta.env.VITE_APP_NAME?.trim() || '盾构隧道掘进施工管理平台',
  apiBase: import.meta.env.VITE_API_BASE?.trim() ?? '',
} as const
