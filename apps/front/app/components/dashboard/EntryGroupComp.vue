<script lang="ts" setup>
import type { EntryGroup } from '~~/server/api/clockodo/entryGroups'

  const props = defineProps<{
    entryGroups?: EntryGroup[]
    recursiveLevel?: number
  }>()
</script>

<template>
  <div>
    <div v-for="(entryGroup, index) of entryGroups" :key="index" class="grid grid-cols-12" >
      <div class="col-span-12">
        <div class="flex justify-between">
          <div :class="(recursiveLevel || 0) >= 2 ? '' : 'text-3xl'">
            {{ entryGroup.name }}
          </div>
          <UBadge v-if="entryGroup.duration" size="lg">
            {{ (entryGroup.duration / 3600).toFixed(2) }}&nbsp;h
          </UBadge>
        </div>
      </div>
      
      <div class="col-span-12 ml-2 pl-4 border-l border-gray-200 dark:border-gray-800 mt-1">
        <EntryGroupComp :entry-groups="entryGroup.sub_groups" :recursive-level="(recursiveLevel || 0) + 1" />
      </div>
    </div>
  </div>
</template>