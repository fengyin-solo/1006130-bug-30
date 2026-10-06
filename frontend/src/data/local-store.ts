import { MODULE_BY_KEY, MODULES } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow, ModuleMeta } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'
// 存储结构版本：每次迁移 +1。旧数据读进来时按检查点逐步迁移，中途失败下次接着跑。
const SCHEMA_VERSION = 2
// 入库重试次数：写入失败一律重试，仍然失败就抛错，内存缓存绝不先于落盘更新。
const WRITE_RETRIES = 3

// v1：直接是 Record<模块, 行[]>；v2：{ version, data } 信封，带迁移检查点。
type StoredEnvelope = { version: number; data: Record<string, unknown[]> }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function toNumberOrNull(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  if (typeof raw === 'boolean' || raw === null || raw === undefined) {
    return null
  }
  const text = String(raw).trim()
  if (text === '') {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * 把任意来源（旧存储 / 流水线 / 新登记）的一行归一成同一口径：
 * - numericFields 里的字段一定是 number，解析不了的回退样例值，再不行回退 0；
 * - 其余业务字段一定是去空白的 string，缺字段按同位置样例补齐而不是整块丢弃；
 * - status 必须在元数据状态表里，pending 由状态位置统一推导，不再各写一套。
 */
export function normalizeRow(
  meta: ModuleMeta,
  sample: EntryRow | undefined,
  raw: unknown,
): EntryRow | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const source = raw as Record<string, unknown>

  const id = toNumberOrNull(source['id']) ?? sample?.id ?? 0
  let status = typeof source['status'] === 'string' ? source['status'].trim() : ''
  if (!meta.statuses.includes(status)) {
    status = sample && meta.statuses.includes(sample.status) ? sample.status : meta.statuses[0]
  }
  const pending = meta.statuses.indexOf(status) < meta.statuses.length - 1
  const abnormal =
    typeof source['abnormal'] === 'boolean'
      ? source['abnormal']
      : typeof sample?.abnormal === 'boolean'
        ? sample.abnormal
        : false

  const row: EntryRow = { id, status, pending, abnormal }
  for (const field of meta.fields) {
    const present = source[field]
    if (meta.numericFields.includes(field)) {
      const numeric = toNumberOrNull(present)
      row[field] = numeric ?? toNumberOrNull(sample?.[field]) ?? 0
    } else {
      const text = present === null || present === undefined ? '' : String(present).trim()
      row[field] = text !== '' ? text : String(sample?.[field] ?? '')
    }
  }
  return row
}

function normalizeModule(key: string, rows: unknown[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return []
  }
  const seeds = SEED_ROWS[key] ?? []
  const normalized: EntryRow[] = []
  rows.forEach((raw, index) => {
    const row = normalizeRow(meta, seeds[index], raw)
    if (row) {
      normalized.push(row)
    }
  })
  return normalized
}

/** 迁移步骤 2（轴线专项）：按环次排序回填、重复测量编号只留最早一条。 */
function migrateAxisRows(rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get('axis')
  if (!meta) {
    return rows
  }
  const seeds = SEED_ROWS['axis'] ?? []
  const ringOf = (row: EntryRow): number => toNumberOrNull(row['对应环号']) ?? Number.MAX_SAFE_INTEGER
  // 按环次顺序迁移；环次不可用时退回 id，保证顺序稳定可重复。
  const ordered = [...rows].sort((a, b) => {
    const diff = ringOf(a) - ringOf(b)
    return diff !== 0 ? diff : Number(a.id) - Number(b.id)
  })
  // 重复登记只留最早那条（排序后首次出现的就是环次最早的一条）。
  const seen = new Set<string>()
  const deduped = ordered.filter((row) => {
    const code = String(row['测量编号'] ?? '').trim()
    if (code === '') {
      return true
    }
    if (seen.has(code)) {
      return false
    }
    seen.add(code)
    return true
  })
  // 环次顺序与样例位置对齐后再归一一次，缺字段按样例补齐（如纠偏措施）。
  return deduped
    .map((row, index) => normalizeRow(meta, seeds[index], row))
    .filter((row): row is EntryRow => row !== null)
}

type Migration = {
  version: number
  run: (data: Record<string, unknown[]>) => Record<string, EntryRow[]>
}

// 迁移必须幂等：每一步重跑结果一致，检查点落盘后中断也能从下一步继续。
const MIGRATIONS: Migration[] = [
  {
    // v1：所有模块统一字段类型口径，缺字段按样例补齐，pending/status 归一。
    version: 1,
    run: (raw) => {
      const next: Record<string, EntryRow[]> = {}
      for (const key of MODULE_BY_KEY.keys()) {
        const rows = Array.isArray(raw[key]) ? raw[key] : clone(SEED_ROWS[key] ?? [])
        next[key] = normalizeModule(key, rows)
      }
      return next
    },
  },
  {
    // v2：轴线测量按环次顺序迁移回填、去重、补齐纠偏措施。
    version: 2,
    run: (raw) => ({
      ...(raw as Record<string, EntryRow[]>),
      axis: migrateAxisRows(Array.isArray(raw['axis']) ? (raw['axis'] as EntryRow[]) : []),
    }),
  },
]

function localStorageRef(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

/** 落盘重试：失败重试到上限再抛错；调用方必须在成功后才允许更新内存。 */
function writeStorage(data: Record<string, EntryRow[]>, version: number): void {
  const storage = localStorageRef()
  if (!storage) {
    return
  }
  const payload = JSON.stringify({ version, data })
  let lastError: unknown = null
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
    try {
      storage.setItem(STORAGE_KEY, payload)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `本地存储写入失败（已重试${WRITE_RETRIES}次），本次改动未入库：${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

function runMigrations(
  raw: Record<string, unknown[]>,
  fromVersion: number,
): Record<string, EntryRow[]> {
  let version = fromVersion
  let data = raw as unknown as Record<string, EntryRow[]>
  for (const step of MIGRATIONS) {
    if (version >= step.version) {
      continue
    }
    data = step.run(data)
    version = step.version
    // 每一步完成立刻落检查点：中途停在这里，下次从下一版本接着跑。
    writeStorage(data, version)
  }
  // 兼容老存储缺模块或后续新增模块：缺口直接补样例。
  let changed = false
  for (const key of MODULE_BY_KEY.keys()) {
    if (!Array.isArray(data[key])) {
      data[key] = clone(SEED_ROWS[key] ?? [])
      changed = true
    }
  }
  if (changed) {
    writeStorage(data, SCHEMA_VERSION)
  }
  return data
}

let cache: Record<string, EntryRow[]> | null = null

function seedStorage(storage: Storage): Record<string, EntryRow[]> {
  const seeded = clone(SEED_ROWS)
  writeStorage(seeded, SCHEMA_VERSION)
  return seeded
}

function load(): Record<string, EntryRow[]> {
  if (cache) {
    return cache
  }
  const storage = localStorageRef()
  if (!storage) {
    cache = clone(SEED_ROWS)
    return cache
  }
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = seedStorage(storage)
    return cache
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    cache = seedStorage(storage)
    return cache
  }
  const envelope = parsed as Partial<StoredEnvelope> | null
  if (envelope && typeof envelope === 'object' && 'version' in envelope && 'data' in envelope) {
    cache = runMigrations(
      (envelope.data ?? {}) as Record<string, unknown[]>,
      Number(envelope.version) || 0,
    )
    return cache
  }
  // 没有信封的就是 v1 裸数据，从 version 0 开始迁移。
  cache = runMigrations(parsed as Record<string, unknown[]>, 0)
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return load()
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/** 整模块替换：先落盘成功才换内存，落盘失败抛错且旧数据不动。 */
export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  writeStorage(next, SCHEMA_VERSION)
  cache = next
}

/** 重置的唯一底层入口：直接回到样例那一份。重复调用结果相同，不会翻倍。 */
export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 全部模块重置：运营概览页走同一个入口，和单模块重置共用一条落盘路径。 */
export function resetAllRows(): Record<string, EntryRow[]> {
  const next = clone(SEED_ROWS)
  writeStorage(next, SCHEMA_VERSION)
  cache = next
  return next
}

export function nextEntryId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/** 新登记行的类型口径与迁移完全一致，避免再出现第二套写法。 */
export function buildNewRow(meta: ModuleMeta, id: number, values: Record<string, string>): EntryRow {
  const source: Record<string, unknown> = { id, status: meta.statuses[0], abnormal: false, ...values }
  const row = normalizeRow(meta, undefined, source)
  if (!row) {
    // 元数据正常时不可能走到这里。
    throw new Error(`${meta.entity}登记内容无法生成有效记录`)
  }
  return row
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function schemaVersion(): number {
  return SCHEMA_VERSION
}

/** 测试用：丢掉内存缓存，强制下次读取重新走存储与迁移。 */
export function _resetCacheForTest(): void {
  cache = null
}

export function _knownModules(): ModuleMeta[] {
  return MODULES
}
