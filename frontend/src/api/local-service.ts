import {
  allRows,
  createRow,
  listRows,
  resetModule as resetStore,
  toNumber,
  updateRows,
} from '@/data/local-store'
import { METRIC_RULES } from '@/data/schema'
import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import type {
  ActionResult,
  EntryRow,
  MetricCard,
  MetricRule,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 提交动作后重读列表的重试参数：失败就重试，绝不拿旧结果顶上来。
const RELOAD_RETRY = 3
const RELOAD_DELAY_MS = 120

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 读取方式沿用既有入口：页面一直是通过 listEntries 拿测量记录，这里不改读法。
export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/**
 * 动作/登记提交后回到列表再看一次：
 * 成功读到新数据才返回；读取抛错就按次数重试，全部失败则抛错，
 * 由页面提示——不允许静默把提交前的旧结果顶上来。
 */
export async function reloadEntries(
  key: string,
  filters: Record<string, string> = {},
): Promise<PageResult> {
  let lastError: unknown
  for (let attempt = 0; attempt < RELOAD_RETRY; attempt += 1) {
    try {
      const payload = listEntries(key, filters)
      if (!Array.isArray(payload.items)) {
        throw new Error('列表数据格式不正确')
      }
      return payload
    } catch (error) {
      lastError = error
      if (attempt < RELOAD_RETRY - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, RELOAD_DELAY_MS))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('列表重读失败，请刷新后重试')
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => toNumber(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  updateRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/**
 * 待纠偏环数的唯一算法：轴线偏差里「超限」或「测量中（还在纠）」且尚未「已纠偏」
 * 的测量条数。轴线偏差页、掘进环次页、管片拼装页都从这里取，重置后天然同步。
 */
export function correctionPendingCount(): number {
  return listRows('axis').filter((row) => {
    const status = String(row.status)
    return status === '超限' || status === '测量中'
  }).length
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function todayString(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// 单个指标按唯一规则求值
function evaluateMetric(key: string, rule: MetricRule): number {
  const rows = listRows(key)
  const byStatus = (statuses?: string[]) =>
    statuses && statuses.length ? rows.filter((row) => statuses.includes(String(row.status))) : rows
  switch (rule.kind) {
    case 'status':
      return rows.filter((row) => String(row.status) === rule.status).length
    case 'statuses':
      return byStatus(rule.statuses as string[] | undefined).length
    case 'pendingStatus':
      return rows.filter((row) => String(row.status) === rule.status && row.pending).length
    case 'abnormal':
      return rows.filter((row) => row.abnormal).length
    case 'sum': {
      const scoped = byStatus(rule.statuses as string[] | undefined)
      return round1(scoped.reduce((sum, row) => sum + toNumber(row[rule.field as string]), 0))
    }
    case 'avg': {
      const scoped = byStatus(rule.statuses as string[] | undefined)
      if (!scoped.length) {
        return 0
      }
      return round1(scoped.reduce((s, row) => s + toNumber(row[rule.field as string]), 0) / scoped.length)
    }
    case 'max': {
      const scoped = byStatus(rule.statuses as string[] | undefined)
      return scoped.reduce((max, row) => Math.max(max, toNumber(row[rule.field as string])), 0)
    }
    case 'todaySum': {
      const today = todayString()
      return round1(
        rows
          .filter((row) => String(row[rule.dateField as string] ?? '').startsWith(today))
          .reduce((sum, row) => sum + toNumber(row[rule.field as string]), 0),
      )
    }
    case 'correction':
      return correctionPendingCount()
    default:
      return 0
  }
}

/** 页面统计卡片唯一来源：所有页面都调它，口径一致、重置后同步。 */
export function moduleStats(key: string): MetricCard[] {
  const rules = METRIC_RULES[key] ?? []
  return rules.map((rule) => ({ label: rule.label, value: evaluateMetric(key, rule) }))
}

export function createEntry(key: string, input: Record<string, unknown>): ActionResult {
  const result = createRow(key, input)
  return { ok: result.ok, message: result.message }
}

// 重置只认 local-store 这一条入口；跑完返回样例那一份。
export function resetModuleEntries(key: string): PageResult {
  resetStore(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = MODULES.map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
