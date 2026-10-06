# 盾构隧道掘进施工管理平台

面向盾构机台账、掘进环次、管片拼装、同步注浆、渣土外运、地表沉降监测与轴线纠偏的一体化盾构隧道施工管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── .env                      依赖版本 / 环境变量 / 构建参数的唯一口径（入仓）
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面（由 scripts/generate-views.mjs 同构生成）
│   ├── src/components/       登记弹窗等共用组件
│   ├── src/config.ts         运行时配置唯一出口（取自根目录 .env）
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、统计、登记、动作流转、重置、导出
│   ├── src/data/             模块元数据 / 字段口径 / 示例数据 / localStorage 持久化
│   ├── scripts/              页面生成器与数据层行为验证（npm run verify）
│   └── vite.config.ts        dev server 配置（envDir 指向仓库根，open: false，无 /api 代理）
├── Makefile
└── docker-compose.yml
```

## 配置口径（只有一份）

依赖版本、环境变量、端口与构建参数全部钉在仓库根目录的 `.env`，本地开发、容器构建与
流水线都从这一份取：

- Vite 用 `envDir` 指向仓库根，读取同一份 `.env`（`frontend/` 下不再放 env 文件）；
  前端代码只通过 `src/config.ts` 访问，不直接读 `import.meta.env`。
- `docker compose` 与 `Makefile` 直接 source 根目录 `.env`，版本号经 `--build-arg`
  注入 Dockerfile；容器内监听地址由 `VITE_DEV_HOST=0.0.0.0` 覆盖。
- `frontend/package.json` 的依赖版本与 `.env` 钉死一致，仓库附带 `package-lock.json`，
  镜像构建优先 `npm ci`。

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 盾构机台账 | `shield` | 盾构机 | 盾构机编号、盾构机型号、开挖直径 |
| 掘进环次 | `ring` | 掘进环 | 环号、起始里程、掘进速度 |
| 管片拼装 | `segment` | 管片环 | 管片环号、管片型号、拼装点位 |
| 同步注浆 | `grouting` | 注浆记录 | 注浆编号、对应环号、浆液配比 |
| 渣土外运 | `muck` | 渣土运输单 | 运输单号、对应环号、渣土方量 |
| 地表沉降 | `settlement` | 沉降测点 | 测点编号、测点位置、初始高程 |
| 轴线偏差 | `axis` | 轴线测量 | 测量编号、对应环号、设计轴线 |
| 刀具磨损 | `cutter` | 刀具 | 刀具编号、刀盘位置、刀具类型 |
| 管片生产 | `segmentprod` | 管片 | 管片编号、管片型号、生产模具 |
| 浆液拌制 | `mortar` | 浆液批次 | 批次编号、浆液类型、水泥用量 |
| 洞内通风 | `ventilation` | 通风机组 | 机组编号、风筒长度、送风量 |
| 建筑监测 | `building` | 监测对象 | 对象编号、建筑物名称、结构类型 |
| 管线探查 | `utility` | 地下管线 | 管线编号、管线类型、埋设深度 |
| 进度节点 | `progress` | 进度节点 | 节点编号、节点名称、计划完成日 |
| 试验检测 | `testing` | 试验委托 | 委托编号、试样类型、检测项目 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练科目、演练日期 |
| 班组进场 | `crew` | 施工班组 | 班组编号、班组名称、主要工种 |
| 安全巡检 | `safety` | 巡检记录 | 巡检编号、巡检区域、巡检项目 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`，再往下只有 `frontend/src/data/local-store.ts` 一个落库出口。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；**数值字段口径、业务主键
  （去重依据）、统计卡片算法**集中在 `frontend/src/data/schema.ts`；示例数据在
  `frontend/src/data/seed.ts`。读出来的数值字段一律是 `number`，容器里旧版本留下的字符串
  会在迁移时统一转型。
- 统计卡片全部由 `moduleStats()` 按 `schema.ts` 的规则实时计算，页面不再写死；
  「待纠偏环数」在轴线偏差、掘进环次、管片拼装三处取的是同一个函数，重置后自动同步。
- 登记走唯一入口 `createEntry()`：业务主键重复只留最早一条（本次直接拒绝、不落库），
  任何写入失败都整体不落；提交成功后会回列表重读（带重试），失败明确报错，不用旧结果顶替。
- 重置走唯一入口（页面「重置为样例数据」按钮或 `resetModuleEntries(模块)`）：
  目标模块跑完只剩样例那一份；重复重置幂等不翻倍；重置是两阶段提交、进度落
  `localStorage` 元数据，中途中断下次进入自动从断掉那一步续跑。首次装载的历史数据迁移
  用同一套幂等机制：测量记录按环次升序回填，缺字段按同序号样例补齐而不是整块丢弃。
- 想回到初始数据：点页面上的「重置为样例数据」，或清掉浏览器里
  `shield-tunnel-construction:entries` 与 `shield-tunnel-construction:meta` 两项。
