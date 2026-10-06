<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
        <button class="btn ghost" type="button" @click="resetAll">全部恢复样例数据</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>记录条数</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else>所有条数与各业务页取同一份数据；数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview, pendingCorrectionRings, resetAllModules } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const errorMessage = ref('')

function refresh() {
  errorMessage.value = ''
  const payload = loadOverview()
  // 待纠偏环数与轴线偏差页、管片拼装页是同一个出处。
  cards.value = [...payload.cards, { label: '待纠偏环数', value: pendingCorrectionRings() }]
  moduleRows.value = payload.modules
}

/** 与各模块页的「恢复样例数据」走同一套重置入口，重置后概览条数跟着回到样例。 */
function resetAll() {
  errorMessage.value = ''
  if (!window.confirm('确定把全部业务模块恢复为样例数据？所有当前登记记录将清除。')) {
    return
  }
  try {
    const payload = resetAllModules()
    cards.value = [...payload.cards, { label: '待纠偏环数', value: pendingCorrectionRings() }]
    moduleRows.value = payload.modules
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '重置失败，请重试'
  }
}

onMounted(refresh)
</script>
