<script lang="ts" setup>
  // Sub-navigation shared by the resource-planning overview and its two
  // management pages. `active` highlights the current tab.
  defineProps<{ active: 'overview' | 'employees' | 'projects' | 'balance' }>()

  const { t } = useI18n()
  const link = useClientPeriodLink()
</script>

<template>
  <div class="flex flex-wrap gap-2 mb-4">
    <UButton
      :to="link('/resource-planning')"
      icon="lucide:chart-column"
      :color="active === 'overview' ? 'primary' : 'neutral'"
      :variant="active === 'overview' ? 'solid' : 'soft'"
      size="sm"
    >
      {{ t('resourcePlanning.tabs.overview') }}
    </UButton>
    <UButton
      :to="link('/resource-planning/employees')"
      icon="lucide:users"
      :color="active === 'employees' ? 'primary' : 'neutral'"
      :variant="active === 'employees' ? 'solid' : 'soft'"
      size="sm"
    >
      {{ t('resourcePlanning.tabs.employees') }}
    </UButton>
    <UButton
      :to="link('/resource-planning/projects')"
      icon="lucide:calendar-clock"
      :color="active === 'projects' ? 'primary' : 'neutral'"
      :variant="active === 'projects' ? 'solid' : 'soft'"
      size="sm"
    >
      {{ t('resourcePlanning.tabs.projects') }}
    </UButton>
    <UButton
      :to="link('/resource-planning/balance')"
      icon="lucide:scale"
      :color="active === 'balance' ? 'primary' : 'neutral'"
      :variant="active === 'balance' ? 'solid' : 'soft'"
      size="sm"
    >
      {{ t('resourcePlanning.tabs.balance') }}
    </UButton>
  </div>
</template>
