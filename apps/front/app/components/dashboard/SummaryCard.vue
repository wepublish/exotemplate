<script lang="ts" setup>
  /**
   * Compact, clickable dashboard tile. Renders title (left) + hour total
   * (top-right) and links into the matching detail page when clicked.
   */
  defineProps<{
    title: string
    hours: number | undefined
    to: string
    color?: 'primary' | 'success' | 'warning' | 'error' | 'info'
    icon?: string
  }>()
</script>

<template>
  <NuxtLink
    :to="to"
    class="block group focus:outline-none"
    :aria-label="`${title} – Details anzeigen`"
  >
    <UPageCard
      class="h-full transition-shadow group-hover:shadow-lg group-focus-visible:ring-2 group-focus-visible:ring-primary cursor-pointer"
    >
      <div class="flex items-center justify-between gap-4 w-full">
        <div class="flex items-center gap-2 min-w-0">
          <UIcon
            v-if="icon"
            :name="icon"
            class="text-primary text-xl shrink-0"
          />
          <div class="font-bold truncate">{{ title }}</div>
        </div>
        <div
          class="font-bold text-4xl whitespace-nowrap"
          :class="`text-${color || 'primary'}`"
        >
          {{ hours ?? 0 }} h
        </div>
      </div>

      <!-- Optional in-card content: e.g. a budget/status alert that should
           share the card's clickable surface so users land on the detail
           page when they tap the alerted card. -->
      <div v-if="$slots.default" class="mt-3">
        <slot />
      </div>

      <div class="flex justify-end items-center text-xs text-muted mt-2">
        <span class="group-hover:text-primary transition-colors">
          Details anzeigen
        </span>
        <UIcon
          name="material-symbols:arrow-forward-rounded"
          class="ml-1 group-hover:text-primary transition-colors"
        />
      </div>
    </UPageCard>
  </NuxtLink>
</template>
