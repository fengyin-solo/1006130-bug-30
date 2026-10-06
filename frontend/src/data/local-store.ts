import { MODULES } from './modules'
import { BUSINESS_KEY, NUMERIC_FIELDS } from './schema'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

/**
 * 本地持久化的唯一实现。页面与 local-service 只准走这里导出的入口：
 * listRows / allRows 读取，createRow 登记，resetModule 重置。
 *
 * 关键约定：
 * - 重置与首次迁移都拆成幂等步骤，进度记在 META_KEY 里；重复执行不翻倍，
 *   中途中断后下次从断掉的那一步接着走。
 * - 每次提交都在内存里算好整份后一次写入；写 localStorage 失败一律不落，旧数据保留。
 * - 轴线测量按对应环号升序回填；缺字段按同序号样例补齐，绝不整块丢弃；
 *   业务主键重复只留最早一条。
 */

const STORAGE_KEY = 'shield-tunnel-construction:entries'
const META_KEY = 'shield-tunnel-construction:meta'
const SCHEMA_VERSION = 2

const MODULE_KEYS = MODULES.map((m) => m.key)

type StoreShape = Record<string, EntryRow[]>
type PendingReset = { id: string; key: string; step: number }
type MetaShape = {
  version: number
  migrated: boolean
  pendingReset?: PendingReset | null
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

// ---- 数值口径：按 schema 把该是数字的字段统一成 number，转不出来记 0 ----
export function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  const trimmed = String(value ?? '').trim()
  if (trimmed === '') {
    return 0
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : 0
}

// ---- 缺字段补齐：先借同序号样例，再退到通用默认值；绝不整块丢弃 ----
function defaultFor(field: string, numericFields: Set<string>): string | number {
  return numericFields.has(field) ? 0 : ''
}

export function normalizeRow(key: string, row: Partial<EntryRow>, seedIndex: number): EntryRow {
  const meta = MODULES.find((m) => m.key === key)
  const sample = SEED_ROWS[key]?.[seedIndex]
  const numericFields = new Set(NUMERIC_FIELDS[key] ?? [])
  const out: EntryRow = {
    id: toNumber(row.id ?? sample?.id ?? seedIndex + 1),
    status: String(row.status ?? sample?.status ?? meta?.statuses[0] ?? ''),
    pending:
      typeof row.pending === 'boolean'
        ? row.pending
        : typeof sample?.pending === 'boolean'
          ? sample.pending
          : true,
    abnormal:
      typeof row.abnormal === 'boolean'
        ? row.abnormal
        : typeof sample?.abnormal === 'boolean'
          ? sample.abnormal
          : false,
  }
  for (const field of meta?.fields ?? []) {
    let value: unknown = row[field]
    if (value === undefined || value === null || String(value).trim() === '') {
      value = sample?.[field]
    }
    if (value === undefined || value === null || String(value) === '') {
      value = defaultFor(field, numericFields)
    }
    out[field] = numericFields.has(field) ? toNumber(value) : String(value)
  }
  // 元数据之外带进来的额外字段也保留，数值口径照常转型
  for (const [field, value] of Object.entries(row)) {
    if (field in out || field === 'id' || field === 'status' || field === 'pending' || field === 'abnormal') {
      continue
    }
    out[field] = numericFields.has(field) ? toNumber(value) : (value as string | number | boolean)
  }
  return out
}

// ---- 业务主键去重：先按 id 升序，再保留主键首次出现（最早）的那条 ----
export function dedupeRows(key: string, rows: EntryRow[]): EntryRow[] {
  const keyField = BUSINESS_KEY[key]
  const ordered = [...rows].sort((a, b) => toNumber(a.id) - toNumber(b.id))
  if (!keyField) {
    return ordered
  }
  const seen = new Set<string>()
  const kept: EntryRow[] = []
  for (const row of ordered) {
    const biz = String(row[keyField] ?? '').trim()
    if (biz !== '' && seen.has(biz)) {
      continue
    }
    if (biz !== '') {
      seen.add(biz)
    }
    kept.push(row)
  }
  return kept
}

function normalizeModule(key: string, rows: unknown): EntryRow[] {
  const source = Array.isArray(rows) ? (rows as Partial<EntryRow>[]) : []
  return dedupeRows(
    key,
    source.map((row, index) => normalizeRow(key, row ?? {}, index)),
  )
}

// ---- 底层读写 ----
function readRawEntries(): StoreShape {
  if (!hasStorage()) {
    return {}
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as StoreShape) : {}
  } catch {
    return {}
  }
}

function readMeta(): MetaShape {
  const fallback: MetaShape = { version: 0, migrated: false, pendingReset: null }
  if (!hasStorage()) {
    return fallback
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(META_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object') {
      return { ...fallback, ...(parsed as MetaShape) }
    }
  } catch {
    /* 元数据损坏按全新处理，entries 由迁移兜底 */
  }
  return fallback
}

let cache: StoreShape | null = null
let cacheMeta: MetaShape | null = null

// 原子提交：整份 entries 与 meta 一次写入；写失败抛错且不动内存，保证「入库失败一律不落」。
function commit(entries: StoreShape, meta: MetaShape): void {
  if (!hasStorage()) {
    cache = entries
    cacheMeta = meta
    return
  }
  const entriesJson = JSON.stringify(entries)
  const metaJson = JSON.stringify(meta)
  window.localStorage.setItem(STORAGE_KEY, entriesJson)
  window.localStorage.setItem(META_KEY, metaJson)
  cache = entries
  cacheMeta = meta
}

// ---- 样例播种 ----
function seedModule(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? []).map((row, index) => normalizeRow(key, row, index))
  if (key === 'axis') {
    rows.sort((a, b) => toNumber(a['对应环号']) - toNumber(b['对应环号']))
  }
  return rows
}

function freshSeed(): StoreShape {
  const seeded: StoreShape = {}
  for (const key of MODULE_KEYS) {
    seeded[key] = seedModule(key)
  }
  return seeded
}

// 旧会话记录迁移：逐行规范化、补缺、去重；轴线测量按环次升序
function migrateEntries(raw: StoreShape): StoreShape {
  const next = freshSeed()
  for (const key of MODULE_KEYS) {
    if (key in raw) {
      next[key] = normalizeModule(key, raw[key])
    }
  }
  if (next.axis) {
    next.axis.sort((a, b) => toNumber(a['对应环号']) - toNumber(b['对应环号']))
  }
  return next
}

/**
 * 首次装载 / 升级迁移。
 * 两步，每步都是幂等的，进度落在 meta 上，重复装载不翻倍、中断后从断点继续：
 *   step 1 prepared：目标数据已在内存算好并连同「迁移中」标记落库
 *   step 2 done    ：打上 migrated=true，与最终数据一起提交
 * 任何一步提交失败都抛错，下次重新从该步来，半成品不会顶上来。
 */
function ensureMigrated(): StoreShape {
  if (cache !== null && cacheMeta !== null) {
    return cache
  }
  const raw = readRawEntries()
  const meta = readMeta()
  const hasAnyRaw = Object.keys(raw).length > 0

  if (meta.migrated && meta.version === SCHEMA_VERSION && hasAnyRaw) {
    cache = migrateEntries(raw)
    cacheMeta = meta
    return cache
  }

  const target = hasAnyRaw ? migrateEntries(raw) : freshSeed()
  const step = meta.version === SCHEMA_VERSION && !meta.migrated ? 1 : 0
  if (step <= 0) {
    // 断点 1：数据落库 + 标记「已准备」（version 先到位，migrated 仍为 false）
    commit(target, { version: SCHEMA_VERSION, migrated: false, pendingReset: null })
  }
  // 断点 2：确认数据已是目标态后收口
  commit(target, { version: SCHEMA_VERSION, migrated: true, pendingReset: cacheMeta?.pendingReset ?? null })
  return target
}

export function allRows(): StoreShape {
  const entries = ensureMigrated()
  const pending = cacheMeta?.pendingReset
  if (pending) {
    // 上次重置中途停下：从断掉那一步续上，再返回
    runReset(pending.key, pending)
  }
  return entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, toNumber(row.id)), 0) + 1
}

export type CreateOutcome = { ok: boolean; message: string; row?: EntryRow }

/**
 * 登记的唯一入口：
 * - 业务主键重复直接判失败，只留最早那条，本次不落库；
 * - 在内存里组装整份后一次提交，提交失败（配额/异常）一律不落，旧数据原样保留。
 */
export function createRow(key: string, input: Record<string, unknown>): CreateOutcome {
  const meta = MODULES.find((m) => m.key === key)
  if (!meta) {
    return { ok: false, message: `没有登记名为 ${key} 的业务模块` }
  }
  const entries = { ...allRows() }
  const rows = dedupeRows(key, entries[key] ?? [])
  const keyField = BUSINESS_KEY[key]
  const bizValue = String(input[keyField] ?? '').trim()
  if (keyField && bizValue !== '' && rows.some((row) => String(row[keyField] ?? '').trim() === bizValue)) {
    return { ok: false, message: `${meta.entity}「${bizValue}」已登记，重复登记只保留最早一条` }
  }
  const row = normalizeRow(key, { ...input, id: nextId(rows) }, rows.length)
  row.status = meta.statuses[0]
  row.pending = meta.statuses.length > 1
  row.abnormal = false

  const nextEntries = { ...entries, [key]: [...rows, row] }
  try {
    commit(nextEntries, { ...(cacheMeta as MetaShape) })
  } catch {
    return { ok: false, message: '入库失败，本次登记未保存，请重试' }
  }
  return { ok: true, message: `${meta.entity}已登记`, row }
}

/**
 * 重置的唯一实现（两阶段提交，全程幂等）：
 *   step 0：把样例整份（替换目标模块）连同 pendingReset 标记一起提交；
 *           中断后 pendingReset 仍在，但数据已是样例——读不到旧记录。
 *   step 1：清掉 pendingReset 收口。
 * 重复重置：每步结果相同，不翻倍；中途停下：allRows() 时从记录的 step 续跑。
 */
function runReset(key: string, resume?: PendingReset | null): EntryRow[] {
  const baseMeta = (cacheMeta as MetaShape) ?? readMeta()
  const resetId = resume?.id ?? `reset-${key}-${Date.now()}`
  const startStep = resume?.step ?? 0
  const baseEntries = (cache as StoreShape) ?? migrateEntries(readRawEntries())

  // step 0：替换成样例 + 挂起标记（同一次原子提交）
  if (startStep <= 0) {
    const replaced: StoreShape = { ...baseEntries, [key]: seedModule(key) }
    commit(replaced, { ...baseMeta, pendingReset: { id: resetId, key, step: 1 } })
  }
  // step 1：收口，清挂起标记
  commit(cache as StoreShape, { ...(cacheMeta as MetaShape), pendingReset: null })
  return (cache as StoreShape)[key] ?? []
}

// 动作流转的落库通道：与登记/重置一样整份原子提交，失败不落。
export function updateRows(key: string, rows: EntryRow[]): void {
  if (cacheMeta === null || cache === null) {
    allRows()
  }
  const next = { ...(cache as StoreShape), [key]: rows }
  commit(next, { ...(cacheMeta as MetaShape) })
}

/** 重置只认这一条入口：跑完目标模块只剩样例那一份。 */
export function resetModule(key: string): EntryRow[] {
  const meta = MODULES.find((m) => m.key === key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  // allRows() 已确保迁移完成，并把上次未跑完的任意模块重置续跑收口
  allRows()
  return runReset(key)
}

export function storageKey(): string {
  return STORAGE_KEY
}
