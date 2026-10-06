import {
  buildNewRow,
  listRows,
  nextEntryId,
  resetAllRows,
  resetRows,
  saveRows,
  allRows,
  toNumberOrNull,
} from '@/data/local-store'
import { MODULE_BY_KEY } from '@/data/modules'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

/** 既有读取方式不变：页面仍然只从这里拿测量记录。 */
export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
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
  try {
    // 先落盘再换内存：入库失败时旧结果原样保留，调用方刷新列表即可重试。
    saveRows(key, next)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '状态更新未入库' }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 重置的唯一业务入口：跑完读到的只剩样例那一份；重复重置不翻倍，本身就是幂等的。 */
export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

/** 全部模块重置：概览页与单模块共用同一条入口（底层同为 resetRows/resetAllRows）。 */
export function resetAllModules(): OverviewResult {
  resetAllRows()
  return loadOverview()
}

// ---------------------------------------------------------------------------
// 指标口径：页面统计卡和概览都从这里取，不再各页硬编码一份。
// ---------------------------------------------------------------------------

/** 待纠偏环数的唯一出处：已提交测量但还没纠偏完成的（测量中 + 超限）。 */
export function pendingCorrectionRings(): number {
  return listRows('axis').filter((row) => ['测量中', '超限'].includes(String(row.status))).length
}

const STATUS_COUNT_METRICS: Record<string, string[]> = {
  在场盾构机: ['调试中', '掘进中'],
  掘进中盾构机: ['掘进中'],
  待维保盾构机: ['调试中'],
  纠偏环数: ['已纠偏'],
  待拼装环数: ['待拼装'],
  已验收环数: ['已验收'],
  返工环数: ['已返工'],
  待补浆记录: ['已补浆'],
  运输中车辆: ['运输中'],
  滞留车次: ['已滞留'],
  正常测点: ['正常'],
  预警测点: ['预警'],
  待测量环数: ['待测量'],
  超限环数: ['超限'],
  正常刀具: ['正常'],
  待更换刀具: ['待更换'],
  累计更换数: ['已更换'],
  养护中管片: ['养护中'],
  待出厂管片: ['待出厂'],
  待拌制批次: ['待拌制'],
  合格批次: ['检验合格'],
  废弃批次: ['已废弃'],
  运行机组: ['运行中'],
  故障机组: ['故障'],
  有害气体超限: ['故障'],
  监测中对象: ['监测中'],
  报警对象: ['已报警'],
  待布点对象: ['待布点'],
  待探查管线: ['待探查'],
  迁改中管线: ['迁改中'],
  已恢复管线: ['已恢复'],
  进行中节点: ['进行中'],
  已完成节点: ['已完成'],
  延期节点: ['已延期'],
  待送样委托: ['待送样'],
  检测中委托: ['检测中'],
  不合格项: ['不合格'],
  待策划演练: ['待策划'],
  已完成演练: ['已完成'],
  待整改问题: ['待整改'],
  在场班组: ['在场'],
  停工班组: ['已停工'],
  待巡检区域: ['待巡检'],
  待整改隐患: ['待整改'],
  已闭环隐患: ['已闭环'],
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function statusCount(rows: EntryRow[], statuses: string[]): number {
  return rows.filter((row) => statuses.includes(String(row.status))).length
}

/** 单模块指标：返回顺序与 meta.metrics 一致，页面直接渲染这一份。 */
export function moduleStats(key: string): { label: string; value: number }[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  return meta.metrics.map((label) => {
    if (label === '待纠偏环数') {
      // 轴线页与管片拼装页的待纠偏环数取自同一个函数，天然同步。
      return { label, value: pendingCorrectionRings() }
    }
    const statuses = STATUS_COUNT_METRICS[label]
    if (statuses) {
      return { label, value: statusCount(rows, statuses) }
    }
    switch (label) {
      case '本月掘进环数':
        return { label, value: rows.filter((row) => !['待掘进'].includes(String(row.status))).length }
      case '平均掘进速度': {
        const speeds = rows
          .map((row) => toNumberOrNull(row['掘进速度']))
          .filter((value): value is number => value !== null && value > 0)
        return {
          label,
          value: speeds.length ? round1(speeds.reduce((sum, value) => sum + value, 0) / speeds.length) : 0,
        }
      }
      case '注浆总量':
        return {
          label,
          value: round1(
            rows.reduce((sum, row) => sum + (toNumberOrNull(row['注浆量']) ?? 0), 0),
          ),
        }
      case '平均注浆压力': {
        const pressures = rows
          .map((row) => toNumberOrNull(row['注浆压力']))
          .filter((value): value is number => value !== null && value > 0)
        return {
          label,
          value: pressures.length
            ? round1(pressures.reduce((sum, value) => sum + value, 0) / pressures.length)
            : 0,
        }
      }
      case '今日外运方量':
        return {
          label,
          value: round1(
            rows
              .filter((row) => ['运输中', '已消纳'].includes(String(row.status)))
              .reduce((sum, row) => sum + (toNumberOrNull(row['渣土方量']) ?? 0), 0),
          ),
        }
      case '最大累计沉降':
        return {
          label,
          value: round1(
            rows.reduce((max, row) => {
              const value = Math.abs(toNumberOrNull(row['累计沉降']) ?? 0)
              return Math.max(max, value)
            }, 0),
          ),
        }
      case '平均水平偏差': {
        const deviations = rows
          .map((row) => toNumberOrNull(row['水平偏差']))
          .filter((value): value is number => value !== null)
        return {
          label,
          value: deviations.length
            ? round1(deviations.reduce((sum, value) => sum + value, 0) / deviations.length)
            : 0,
        }
      }
      case '本月出厂数':
        return { label, value: statusCount(rows, ['已出厂']) }
      case '在场人数':
        return {
          label,
          value: rows
            .filter((row) => String(row.status) === '在场')
            .reduce((sum, row) => sum + (toNumberOrNull(row['进场人数']) ?? 0), 0),
        }
      default:
        return { label, value: 0 }
    }
  })
}

/**
 * 新登记的唯一入口：
 * - 业务编号重复时只允许最早那条存在，后来的一律拒掉，不入库；
 * - 落盘失败（重试仍失败）抛错由这里接住返回失败，内存里不落任何东西。
 */
export function createEntry(key: string, values: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  const trimmed: Record<string, string> = {}
  for (const field of meta.fields) {
    trimmed[field] = (values[field] ?? '').trim()
  }
  const codeField = meta.fields[0]
  if (!trimmed[codeField]) {
    return { ok: false, message: `${codeField}不能为空` }
  }
  const rows = listRows(key)
  if (rows.some((row) => String(row[codeField] ?? '').trim() === trimmed[codeField])) {
    return {
      ok: false,
      message: `${codeField}「${trimmed[codeField]}」已登记，重复登记只保留最早一条`,
    }
  }
  const row = buildNewRow(meta, nextEntryId(rows), trimmed)
  try {
    saveRows(key, [...rows, row])
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '登记未入库，请重试' }
  }
  return { ok: true, message: `${meta.entity}「${trimmed[codeField]}」已登记` }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
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
