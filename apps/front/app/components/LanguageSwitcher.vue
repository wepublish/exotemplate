<script lang="ts" setup>
  import type { DropdownMenuItem } from '@nuxt/ui'

  const { t } = useI18n()
  const { currentLocale, setUserLanguage, SUPPORTED_LOCALES } = useAppLocale()

  const items = computed<DropdownMenuItem[]>(() =>
    SUPPORTED_LOCALES.map((code) => ({
      label: t(`nav.language.${code}`),
      icon: code === currentLocale() ? 'lucide:check' : undefined,
      onSelect: () => {
        void setUserLanguage(code)
      }
    }))
  )
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UButton
      icon="lucide:languages"
      color="neutral"
      variant="ghost"
      :aria-label="t('nav.language.label')"
    />
  </UDropdownMenu>
</template>
