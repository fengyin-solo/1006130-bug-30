import type { MetricRule } from './types'

/**
 * 字段口径的唯一来源：
 * - NUMERIC_FIELDS：这些字段读出来必须是 number。本地直接读种子时是数值，
 *   容器里旧版本种子/会话里留下的是字符串，统一在读取层按这份清单转型，
 *   转不出数字的按 0 处理，避免平均值/合计被字符串污染。
 * - BUSINESS_KEY：登记去重依据，重复登记只保留最早那条。
 * - METRIC_RULES：各页面统计卡片的算法，管片拼装/掘进环次的「待纠偏环数」
 *   与轴线偏差页取同一份（correction 规则），重置后自动同步。
 */

export const NUMERIC_FIELDS: Record<string, string[]> = {
  shield: ['开挖直径', '总推力'],
  ring: ['起始里程', '掘进速度', '总推力', '刀盘扭矩', '出土方量'],
  segment: ['螺栓扭矩', '错台量'],
  grouting: ['注浆量', '注浆压力'],
  muck: ['渣土方量'],
  settlement: ['初始高程', '累计沉降', '沉降速率', '预警阈值'],
  axis: ['对应环号', '水平偏差', '垂直偏差'],
  cutter: ['初始直径', '当前磨损量'],
  segmentprod: ['养护天数', '出厂强度'],
  mortar: ['水泥用量', '膨润土用量', '水灰比', '稠度'],
  ventilation: ['风筒长度', '送风量', '洞内温度', '有害气体浓度'],
  building: ['距隧道距离', '允许沉降', '实测沉降'],
  utility: ['埋设深度', '管线管径', '与隧道净距'],
  progress: ['计划掘进量', '实际掘进量', '偏差天数'],
  testing: [],
  drill: ['演练时长'],
  crew: ['进场人数'],
  safety: [],
}

// 每个模块第一列业务编号字段，用于登记去重（保留最早一条）。
export const BUSINESS_KEY: Record<string, string> = {
  shield: '盾构机编号',
  ring: '环号',
  segment: '管片环号',
  grouting: '注浆编号',
  muck: '运输单号',
  settlement: '测点编号',
  axis: '测量编号',
  cutter: '刀具编号',
  segmentprod: '管片编号',
  mortar: '批次编号',
  ventilation: '机组编号',
  building: '对象编号',
  utility: '管线编号',
  progress: '节点编号',
  testing: '委托编号',
  drill: '演练编号',
  crew: '班组编号',
  safety: '巡检编号',
}

export const METRIC_RULES: Record<string, MetricRule[]> = {
  shield: [
    { label: '在场盾构机', kind: 'statuses', statuses: ['调试中', '掘进中'] },
    { label: '掘进中盾构机', kind: 'status', status: '掘进中' },
    { label: '待维保盾构机', kind: 'abnormal' },
  ],
  ring: [
    { label: '本月掘进环数', kind: 'statuses', statuses: ['掘进中', '已贯通', '已纠偏'] },
    { label: '平均掘进速度', kind: 'avg', field: '掘进速度', statuses: ['掘进中', '已贯通', '已纠偏'] },
    { label: '纠偏环数', kind: 'correction' },
  ],
  segment: [
    { label: '待拼装环数', kind: 'pendingStatus', status: '待拼装' },
    { label: '已验收环数', kind: 'status', status: '已验收' },
    { label: '返工环数', kind: 'status', status: '已返工' },
    { label: '待纠偏环数', kind: 'correction' },
  ],
  grouting: [
    { label: '注浆总量', kind: 'sum', field: '注浆量', statuses: ['注浆中', '已完成', '已补浆'] },
    { label: '待补浆记录', kind: 'status', status: '已补浆' },
    { label: '平均注浆压力', kind: 'avg', field: '注浆压力', statuses: ['注浆中', '已完成', '已补浆'] },
  ],
  muck: [
    { label: '今日外运方量', kind: 'todaySum', field: '渣土方量', dateField: '外运时段' },
    { label: '运输中车辆', kind: 'status', status: '运输中' },
    { label: '滞留车次', kind: 'status', status: '已滞留' },
  ],
  settlement: [
    { label: '正常测点', kind: 'status', status: '正常' },
    { label: '预警测点', kind: 'status', status: '预警' },
    { label: '最大累计沉降', kind: 'max', field: '累计沉降', statuses: ['预警', '报警'] },
  ],
  axis: [
    { label: '待测量环数', kind: 'pendingStatus', status: '待测量' },
    { label: '超限环数', kind: 'status', status: '超限' },
    { label: '平均偏差', kind: 'avg', field: '水平偏差' },
    { label: '待纠偏环数', kind: 'correction' },
  ],
  cutter: [
    { label: '正常刀具', kind: 'status', status: '正常' },
    { label: '待更换刀具', kind: 'status', status: '待更换' },
    { label: '累计更换数', kind: 'status', status: '已更换' },
  ],
  segmentprod: [
    { label: '养护中管片', kind: 'status', status: '养护中' },
    { label: '待出厂管片', kind: 'status', status: '待出厂' },
    { label: '本月出厂数', kind: 'status', status: '已出厂' },
  ],
  mortar: [
    { label: '待拌制批次', kind: 'status', status: '待拌制' },
    { label: '合格批次', kind: 'status', status: '检验合格' },
    { label: '废弃批次', kind: 'status', status: '已废弃' },
  ],
  ventilation: [
    { label: '运行机组', kind: 'status', status: '运行中' },
    { label: '故障机组', kind: 'status', status: '故障' },
    { label: '有害气体超限', kind: 'abnormal' },
  ],
  building: [
    { label: '监测中对象', kind: 'status', status: '监测中' },
    { label: '报警对象', kind: 'status', status: '已报警' },
    { label: '待布点对象', kind: 'status', status: '待布点' },
  ],
  utility: [
    { label: '待探查管线', kind: 'status', status: '待探查' },
    { label: '迁改中管线', kind: 'status', status: '迁改中' },
    { label: '已恢复管线', kind: 'status', status: '已恢复' },
  ],
  progress: [
    { label: '进行中节点', kind: 'status', status: '进行中' },
    { label: '已完成节点', kind: 'status', status: '已完成' },
    { label: '延期节点', kind: 'status', status: '已延期' },
  ],
  testing: [
    { label: '待送样委托', kind: 'status', status: '待送样' },
    { label: '检测中委托', kind: 'status', status: '检测中' },
    { label: '不合格项', kind: 'status', status: '不合格' },
  ],
  drill: [
    { label: '待策划演练', kind: 'status', status: '待策划' },
    { label: '已完成演练', kind: 'status', status: '已完成' },
    { label: '待整改问题', kind: 'status', status: '已整改' },
  ],
  crew: [
    { label: '在场班组', kind: 'status', status: '在场' },
    { label: '在场人数', kind: 'sum', field: '进场人数', statuses: ['在场'] },
    { label: '停工班组', kind: 'status', status: '已停工' },
  ],
  safety: [
    { label: '待巡检区域', kind: 'status', status: '待巡检' },
    { label: '待整改隐患', kind: 'status', status: '待整改' },
    { label: '已闭环隐患', kind: 'status', status: '已闭环' },
  ],
}
