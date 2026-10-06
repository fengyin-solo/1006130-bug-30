/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

// 统计卡片唯一口径：所有页面的指标都按这份规则在 local-service 里算，页面不再写死。
export type MetricRule = {
  label: string
  // status        : 某状态条数；statuses 同义，可给多个状态
  // pendingStatus : 命中给定状态（视为待办）的条数
  // abnormal      : 异常条数
  // sum/avg/max   : 对数值字段聚合；statuses 给定时只统计这些状态的行
  // todaySum      : 当日（dateField 为今天）某数值字段合计
  // correction    : 待纠偏环数——取轴线偏差模块，管片拼装/掘进环次与它同源
  kind: 'status' | 'statuses' | 'pendingStatus' | 'abnormal' | 'sum' | 'avg' | 'max' | 'todaySum' | 'correction'
  status?: string
  statuses?: string[]
  field?: string
  dateField?: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type MetricCard = { label: string; value: number }

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
