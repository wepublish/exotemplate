<script lang="ts" setup>
  import { linkifyText } from '~/utils/linkify'

  const props = defineProps<{
    text: string | null | undefined
  }>()

  const segments = computed(() => linkifyText(props.text))
</script>

<template>
  <span>
    <template v-for="(segment, index) in segments" :key="index">
      <a
        v-if="segment.type === 'link'"
        :href="segment.href"
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary underline hover:no-underline break-words"
        @click.stop
      >
        {{ segment.value }}
      </a>
      <template v-else>{{ segment.value }}</template>
    </template>
  </span>
</template>
