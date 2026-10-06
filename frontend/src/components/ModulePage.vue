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
        <button class="btn ghost" type="button" @click="resetData">恢复样例数据</button>
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
          <td v-for="column in meta.fields" :key="column">{{ formatCell(row[column]) }}</td>
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

    <div v-if="creating" class="modal-overlay" @click.self="closeCreate">
      <div class="modal">
        <h3 class="modal-title">登记{{ meta.entity }}</h3>
        <div class="form-grid">
          <label v-for="field in meta.fields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input
              v-model="draft[field]"
              :type="meta.numericFields.includes(field) ? 'number' : 'text'"
              :step="meta.numericFields.includes(field) ? 'any' : undefined"
              :placeholder="`请输入${field}`"
            />
          </label>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitCreate">提交</button>
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  moduleStats,
  resetModule,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ module: string }>()

const meta = moduleMeta(props.module)
const filterFields = meta.fields.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref<{ label: string; value: number }[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const creating = ref(false)
const formError = ref('')
const draft = reactive<Record<string, string>>({})

const statusSummary = computed(() =>
  meta.statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }
  return String(value)
}

function emptyDraft() {
  for (const field of meta.fields) {
    draft[field] = ''
  }
}

function openCreate() {
  errorMessage.value = ''
  formError.value = ''
  emptyDraft()
  creating.value = true
}

function closeCreate() {
  creating.value = false
  formError.value = ''
}

/** 提交完回列表再读一次；失败保留表单可直接重试，旧结果不会顶上来（入库失败不落）。 */
function submitCreate() {
  formError.value = ''
  const result = createEntry(meta.key, { ...draft })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  creating.value = false
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

/** 所有页面的重置走同一个入口：重置后只剩样例那一份，统计卡与列表一起重读。 */
function resetData() {
  errorMessage.value = ''
  if (!window.confirm(`确定把${meta.name}恢复为样例数据？当前登记记录将全部清除。`)) {
    return
  }
  try {
    const payload = resetModule(meta.key)
    rows.value = payload.items
    total.value = payload.total
    stats.value = moduleStats(meta.key)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '重置失败，请重试'
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = moduleStats(meta.key)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${meta.name}列表读取失败`
  }
}

onMounted(reload)
</script>
