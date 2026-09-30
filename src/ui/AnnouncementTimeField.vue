<script setup lang="ts">
import { computed, ref, watch } from 'vue'
const props=defineProps<{label:string; modelValue:string}>()
const emit=defineEmits<{ 'update:modelValue':[value:string] }>()
const date=ref(props.modelValue.slice(0,10)), hour=ref(props.modelValue.slice(11,13)), minute=ref(props.modelValue.slice(14,16))
const required=computed(()=>Boolean(date.value || hour.value || minute.value))
watch([date,hour,minute],()=>emit('update:modelValue',required.value ? `${date.value}T${hour.value}:${minute.value}` : ''))
function clear() { date.value='';hour.value='';minute.value='' }
</script>
<template>
  <fieldset class="announcement-time-field">
    <legend>{{ label }}</legend>
    <div class="announcement-time-fields">
      <label>日期<input
        v-model="date"
        type="date"
        :required="required"
      /></label>
      <label>时<select
        v-model="hour"
        :required="required"
      ><option
        value=""
        hidden
      ></option><option
        v-for="n in 24"
        :key="n"
        :value="String(n-1).padStart(2,'0')"
      >{{ String(n-1).padStart(2,'0') }}</option></select></label>
      <label>分<select
        v-model="minute"
        :required="required"
      ><option
        value=""
        hidden
      ></option><option
        v-for="n in 60"
        :key="n"
        :value="String(n-1).padStart(2,'0')"
      >{{ String(n-1).padStart(2,'0') }}</option></select></label>
    </div>
    <button
      v-if="required"
      type="button"
      class="announcement-time-clear"
      @click="clear"
    >
      清空时间
    </button>
  </fieldset>
</template>
