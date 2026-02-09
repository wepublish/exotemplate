<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'

  const schema = z.object({
    amount: z.number('Bitte Anzahl Stunden eingeben')
  })
</script>

<template>
  <UPageCard>
    <UForm> </UForm>
  </UPageCard>
</template>

<style></style>
