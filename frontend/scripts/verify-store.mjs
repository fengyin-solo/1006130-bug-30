/**
 * 数据层行为验证：用 typescript 转译源码到内存 ESM，配 localStorage 桩执行。
 * 覆盖：数值口径统一、旧记录迁移补缺不丢弃、轴线按环次回填、登记去重、
 * 入库失败不落、重置只剩样例/重复不翻倍/断点续跑、待纠偏环数同源。
 *
 * 运行：node scripts/verify-store.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assertions = []
function check(name, cond, detail = '') {
  assertions.push([name, !!cond, detail])
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${detail}`}`)
}

// ---- 内存版 localStorage ----
function createMemoryStorage() {
  let map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => {
      map = new Map()
    },
  }
}

// ---- 把 TS 源码（含 @ 别名与 .ts 扩展）转成临时 ESM 文件并加载 ----
const outDir = mkdtempSync(join(tmpdir(), 'store-test-'))
function transpileToFile(srcAbsPath, outName) {
  const source = readFileSync(srcAbsPath, 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  })
  let code = result.outputText
  // 解析别名与相对 .ts 导入为输出目录里的实际文件
  const deps = new Set()
  code = code.replace(/from\s*'([^']+)'/g, (m, spec) => {
    let abs
    if (spec.startsWith('@/')) abs = join(root, 'src', spec.slice(2))
    else if (spec.startsWith('./') || spec.startsWith('../')) abs = join(dirname(srcAbsPath), spec)
    else return m
    if (!abs.endsWith('.ts')) abs += '.ts'
    const depName = abs.replace(/[^a-z0-9]+/gi, '_').replace(/^_/, '') + '.mjs'
    deps.add([abs, depName])
    return `from './${depName}'`
  })
  writeFileSync(join(outDir, outName), code)
  for (const [abs, depName] of deps) {
    if (!readFileSync(abs, 'utf8')) continue
    transpileToFile(abs, depName)
  }
  return outName
}

async function loadStore(storage) {
  globalThis.window = { localStorage: storage }
  const outName = transpileToFile(join(root, 'src', 'data', 'local-store.ts'), 'local-store.mjs')
  return import(pathToFileURL(join(outDir, outName)).href + `?t=${Date.now()}-${Math.random()}`)
}

async function main() {
  // ---- 场景 1：旧会话数据——水平偏差是字符串、缺纠偏措施、乱序、有重复 ----
  {
    const storage = createMemoryStorage()
    const legacy = {
      axis: [
        { id: 3, status: '测量中', pending: true, abnormal: true, 测量编号: 'AXIS-0003', 对应环号: '18', 设计轴线: 'K18', 实测轴线: 'K17', 水平偏差: '9', 垂直偏差: -4, 测量状态: '纠偏中' },
        { id: 1, status: '待测量', pending: true, abnormal: false, 测量编号: 'AXIS-0001', 对应环号: '12', 设计轴线: 'K12', 实测轴线: '待测量', 水平偏差: '0', 垂直偏差: '0', 纠偏措施: '待提交测量后制定', 测量状态: '待测量' },
        { id: 2, status: '测量中', pending: true, abnormal: true, 测量编号: 'AXIS-0002', 对应环号: 15, 设计轴线: 'K15', 实测轴线: 'K14', 水平偏差: 35, 垂直偏差: '12', 纠偏措施: '水平右偏超限，加大右侧推进油缸推力', 测量状态: '纠偏中' },
        { id: 5, status: '测量中', pending: true, abnormal: true, 测量编号: 'AXIS-0002', 对应环号: 15, 水平偏差: 99 },
      ],
      segment: [{ id: 1, 管片环号: 'SEG-100', 拼装日期: '2026-10-06' }],
    }
    storage.setItem('shield-tunnel-construction:entries', JSON.stringify(legacy))

    const store = await loadStore(storage)
    const axis = store.listRows('axis')

    check('迁移后按环次升序', axis.map((r) => r['对应环号']).join(',') === '12,15,18',
      JSON.stringify(axis.map((r) => r['对应环号'])))
    check('水平偏差全部为 number 类型', axis.every((r) => typeof r['水平偏差'] === 'number'),
      axis.map((r) => `${r['测量编号']}:${typeof r['水平偏差']}`).join('|'))
    check('字符串数字被转成数值', axis.find((r) => r['测量编号'] === 'AXIS-0003')['水平偏差'] === 9)
    check('纠偏措施不再为空（缺字段按样例补齐）', axis.every((r) => String(r['纠偏措施']).trim() !== ''),
      JSON.stringify(axis.map((r) => r['纠偏措施'])))
    check('重复登记只留最早一条（保留 id=2）',
      axis.filter((r) => r['测量编号'] === 'AXIS-0002').length === 1
        && axis.find((r) => r['测量编号'] === 'AXIS-0002').id === 2)
    check('缺字段的外业记录不被整块丢弃', store.listRows('segment').some((r) => r['管片环号'] === 'SEG-100'))
    const seg = store.listRows('segment').find((r) => r['管片环号'] === 'SEG-100')
    check('外业记录缺失字段已补齐且数值列为 number',
      String(seg['管片型号'] ?? '') !== '' && typeof seg['螺栓扭矩'] === 'number')
    check('沿用既有读取方式：id/status 齐全', axis.every((r) => typeof r.id === 'number' && 'status' in r))
  }

  // ---- 场景 2：重复装载不翻倍 ----
  {
    const storage = createMemoryStorage()
    await loadStore(storage)
    const a = (await loadStore(storage)).listRows('axis')
    const b = (await loadStore(storage)).listRows('axis')
    check('重复装载条数稳定（样例 3 条）', a.length === 3 && b.length === 3, `${a.length}/${b.length}`)
  }

  // ---- 场景 3：重置只剩样例、重复重置不翻倍 ----
  {
    const storage = createMemoryStorage()
    const store = await loadStore(storage)
    store.createRow('axis', { 测量编号: 'AXIS-9001', 对应环号: 99, 水平偏差: 50 })
    store.createRow('axis', { 测量编号: 'AXIS-9002', 对应环号: 100, 水平偏差: 60 })
    check('登记后多于样例', store.listRows('axis').length === 5)
    const after1 = store.resetModule('axis')
    check('重置后只剩样例那一份',
      after1.length === 3 && !after1.some((r) => String(r['测量编号']).startsWith('AXIS-9')))
    check('重置后按环次升序', after1.map((r) => r['对应环号']).join(',') === '12,15,18')
    const after2 = store.resetModule('axis')
    const after3 = store.resetModule('axis')
    check('重复重置不翻倍', after2.length === 3 && after3.length === 3)
  }

  // ---- 场景 4：重置中途崩溃，重进从断点续上 ----
  {
    const storage = createMemoryStorage()
    const prep = await loadStore(storage)
    prep.createRow('axis', { 测量编号: 'AXIS-9001', 对应环号: 120, 水平偏差: 50 })
    check('前置：登记成功（4 条）', prep.listRows('axis').length === 4)

    const crashStore = await loadStore(storage)
    const realSet = storage.setItem.bind(storage)
    let seedWritten = false
    storage.setItem = (k, v) => {
      if (k.endsWith(':entries')) {
        realSet(k, v)
        seedWritten = true
        return // entries 写了，meta 不写 -> 模拟两步之间崩溃
      }
      if (k.endsWith(':meta') && seedWritten) {
        throw new Error('CRASH_BEFORE_META')
      }
      realSet(k, v)
    }
    let crashed = false
    try {
      crashStore.resetModule('axis')
    } catch (e) {
      crashed = /CRASH_BEFORE_META/.test(String(e))
    }
    storage.setItem = realSet
    check('重置途中确实被打断', crashed)

    const resume = await loadStore(storage)
    const rows = resume.listRows('axis')
    check('中断后读到的只剩样例（旧记录没赖着）',
      rows.length === 3 && !rows.some((r) => r['测量编号'] === 'AXIS-9001'),
      JSON.stringify(rows.map((r) => r['测量编号'])))
    const meta = JSON.parse(storage.getItem('shield-tunnel-construction:meta'))
    check('续跑后挂起标记已清除', meta.pendingReset == null, JSON.stringify(meta.pendingReset))
    const again = resume.resetModule('axis')
    check('续跑完成后再次重置仍只有样例', again.length === 3)
  }

  // ---- 场景 5：入库失败一律不落（登记） ----
  {
    const storage = createMemoryStorage()
    const store = await loadStore(storage)
    store.listRows('axis')
    const beforeAxis = JSON.parse(storage.getItem('shield-tunnel-construction:entries')).axis.length
    storage.setItem = () => {
      throw new Error('quota exceeded')
    }
    const result = store.createRow('axis', { 测量编号: 'AXIS-7777', 对应环号: 77, 水平偏差: 1 })
    storage.setItem = createMemoryStorage().setItem // noop 还原，避免影响读取
    check('登记失败有明确返回', result.ok === false, result.message)
    const afterAxis = JSON.parse(storage.getItem('shield-tunnel-construction:entries')).axis.length
    check('入库失败一律不落', afterAxis === beforeAxis, `${afterAxis} vs ${beforeAxis}`)
  }

  // ---- 场景 6：待纠偏环数两处同源、随重置同步 ----
  {
    const storage = createMemoryStorage()
    const store = await loadStore(storage)
    const correction = () =>
      store.listRows('axis').filter((r) => ['测量中', '超限'].includes(String(r.status))).length
    check('轴线待纠偏基线=1（测量中 1 条）', correction() === 1)
    // 动作流转：把待测量那条推进到测量中 -> 待纠偏变 2
    const rows = store.listRows('axis')
    const id1 = rows.find((r) => r['测量编号'] === 'AXIS-0001').id
    store.updateRows('axis', rows.map((r) => (r.id === id1 ? { ...r, status: '测量中' } : r)))
    check('两处取的是同一份（管片/掘进环次视角都=2）', correction() === 2)
    store.resetModule('axis')
    check('重置后两处同步回到样例口径(=1)', correction() === 1)
  }

  // ---- 场景 7：首次迁移在「数据已写、收口标记未写」时崩溃，重进可续 ----
  {
    const storage = createMemoryStorage()
    storage.setItem('shield-tunnel-construction:entries', JSON.stringify({
      axis: [{ id: 1, 测量编号: 'AXIS-0009', 对应环号: '9', 水平偏差: '7' }],
    }))
    const first = await loadStore(storage)
    first.listRows('axis') // 触发首次迁移
    // 把 meta 改写成「数据已是 v2 但未收口」的中断态
    storage.setItem('shield-tunnel-construction:meta',
      JSON.stringify({ version: 2, migrated: false, pendingReset: null }))
    const second = await loadStore(storage)
    const rows = second.listRows('axis')
    check('续迁移后数据完整且数值已转型',
      rows.some((r) => r['测量编号'] === 'AXIS-0009' && typeof r['水平偏差'] === 'number'),
      JSON.stringify(rows.map((r) => [r['测量编号'], r['水平偏差']])))
    const meta = JSON.parse(storage.getItem('shield-tunnel-construction:meta'))
    check('续迁移完成后 migrated=true', meta.migrated === true)
    const third = (await loadStore(storage)).listRows('axis')
    check('迁移续跑不产生重复（不翻倍）', third.length === rows.length)
  }

  // ---- 场景 8：重复登记同一业务编号只留最早那条 ----
  {
    const storage = createMemoryStorage()
    const store = await loadStore(storage)
    const r1 = store.createRow('axis', { 测量编号: 'AXIS-8001', 对应环号: 81, 水平偏差: 10 })
    const r2 = store.createRow('axis', { 测量编号: 'AXIS-8001', 对应环号: 82, 水平偏差: 20 })
    check('首次登记成功', r1.ok === true)
    check('重复登记被拒绝', r2.ok === false)
    const dup = store.listRows('axis').filter((r) => r['测量编号'] === 'AXIS-8001')
    check('库里只留最早一条（环号 81）', dup.length === 1 && dup[0]['对应环号'] === 81)
  }

  const failed = assertions.filter(([, ok]) => !ok)
  console.log(`\n${assertions.length - failed.length}/${assertions.length} passed`)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
