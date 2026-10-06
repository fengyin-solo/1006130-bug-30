<template>
  <section class="page" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }}管理</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记{{ meta.entity }}</button>
        <button class="btn" type="button" @click="exportRows">导出{{ meta.name }}清单</button>
        <button class="btn ghost" type="button" :disabled="resetting" @click="resetData">
          {{ resetting ? '重置中…' : '重置为样例数据' }}
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in meta.fields" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in meta.fields" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in meta.actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="meta.fields.length + 2" class="empty-state">
            暂无{{ meta.name }}数据，可先登记{{ meta.entity }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ meta.name }}记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <EntryCreateModal :open="createOpen" :meta="meta" :on-submit="handleCreate" @close="createOpen = false" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import EntryCreateModal from '@/components/EntryCreateModal.vue'
import {
  createEntry,
  downloadEntries,
  moduleMeta,
  moduleStats,
  reloadEntries,
  resetModuleEntries,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, MetricCard } from '@/data/types'

const meta = moduleMeta('segmentprod')

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref<MetricCard[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = meta.fields.slice(0, 3)
const createOpen = ref(false)
const resetting = ref(false)

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 统计始终按全量数据算（不受筛选影响），所有页面同一份口径
function refreshStats() {
  stats.value = moduleStats(meta.key)
}

function resetFilters() {
  filters.value = {}
  void reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = ''
  createOpen.value = true
}

// 登记 -> 回列表再看一次（service 内部失败重试，旧结果不许顶上来）
async function handleCreate(input: Record<string, unknown>) {
  const result = createEntry(meta.key, input)
  if (!result.ok) {
    throw new Error(result.message)
  }
  await reload()
}

async function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  await reload()
}

// 重置走唯一入口：跑完只剩样例那一份；重读同样带重试。
async function resetData() {
  errorMessage.value = ''
  resetting.value = true
  try {
    resetModuleEntries(meta.key)
    await reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '重置失败，请重试'
  } finally {
    resetting.value = false
  }
}

async function reload() {
  errorMessage.value = ''
  try {
    const payload = await reloadEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    refreshStats()
  } catch (error) {
    // 读不回来就明说，不拿旧列表冒充新结果
    errorMessage.value = error instanceof Error ? error.message : meta.name + '列表读取失败'
    refreshStats()
  }
}

onMounted(reload)
</script>
