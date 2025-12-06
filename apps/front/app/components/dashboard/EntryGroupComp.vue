<script lang="ts" setup>
import type { EntryGroup } from '~~/server/api/clockodo/entryGroups'

  const props = defineProps<{
    entryGroups?: EntryGroup[]
    recursiveLevel?: number
  }>()
</script>

<template>
  <UAccordion :items="props.entryGroups">
    <template #leading="{item}">
      <div style="width: 100%;" class="flex justify-between text-start">
        <p>{{ item.name }}</p>
        <UBadge v-if="item.duration" size="lg">
          {{ (item.duration / 3600).toFixed(2) }}&nbsp;h
        </UBadge>
      </div>
    </template>
    <template #body="item">
      <EntryGroupComp
        v-if="!!item.item.sub_groups.length"
        :entry-groups="item.item.sub_groups"
        :recursive-level="(recursiveLevel || 0) + 1"
        class="ml-2 pl-4 border-l border-gray-200 dark:border-gray-800"
      />
    </template>
  </UAccordion>
</template>