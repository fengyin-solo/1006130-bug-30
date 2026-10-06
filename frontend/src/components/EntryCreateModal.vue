<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal-card" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h3>登记{{ meta.entity }}</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>
      <form class="modal-body" @submit.prevent="submit">
        <label v-for="field in formFields" :key="field" class="filter-item modal-field">
          <span>{{ field }}</span>
          <input
            v-model="form[field]"
            :type="numericFields.has(field) ? 'number' : 'text'"
            :step="numericFields.has(field) ? 'any' : undefined"
            :placeholder="`请输入${field}`"
          />
        </label>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="close">取消</button>
          <button class="btn primary" type="submit" :disabled="submitting">
            {{ submitting ? '提交中…' : '提交登记' }}
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

import { NUMERIC_FIELDS } from '@/data/schema'
import type { ModuleMeta } from '@/data/types'

const props = defineProps<{
  open: boolean
  meta: ModuleMeta
  // 父组件执行真正的登记 + 回列表重读（含失败重试）；抛错则弹窗保留并提示
  onSubmit: (input: Record<string, unknown>) => Promise<void> | void
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

// 最后一列是状态展示字段，不由登记人填写
const formFields = props.meta.fields.slice(0, -1)
const numericFields = new Set(NUMERIC_FIELDS[props.meta.key] ?? [])

const form = reactive<Record<string, string>>({})
const errorMessage = ref('')
const submitting = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) {
      for (const field of formFields) {
        form[field] = ''
      }
      errorMessage.value = ''
      submitting.value = false
    }
  },
)

function close() {
  if (submitting.value) {
    return
  }
  emit('close')
}

async function submit() {
  errorMessage.value = ''
  const input: Record<string, unknown> = {}
  for (const field of formFields) {
    const raw = form[field]?.trim() ?? ''
    input[field] = numericFields.has(field) ? (raw === '' ? 0 : Number(raw)) : raw
  }
  const keyField = props.meta.fields[0]
  if (String(input[keyField] ?? '').trim() === '') {
    errorMessage.value = `${keyField}不能为空`
    return
  }
  if (numericFields.has(keyField) && Number.isNaN(Number(input[keyField]))) {
    errorMessage.value = `${keyField}必须是数值`
    return
  }
  submitting.value = true
  try {
    await props.onSubmit(input)
    emit('close')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '登记失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>
