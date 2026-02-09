<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import { format, subMonths } from 'date-fns'
  import { de } from 'date-fns/locale'

  const toast = useToast()

  const previousMonthName = format(subMonths(new Date(), 1), 'LLLL', {
    locale: de
  })

  const previousMonthYear = format(subMonths(new Date(), 1), 'yyyy')

  const schema = z.object({
    amount: z.number('Anzahl Stunden eingeben'),
    hourlyRate: z.number('Stundensatz eingeben'),
    wepPercentage: z.number('Prozent für We.Publish eingeben'),
    note: z.optional(z.string('Bemerkung eingeben'))
  })

  type Schema = z.output<typeof schema>

  const state = reactive<Partial<Schema>>({
    amount: undefined,
    hourlyRate: 150,
    wepPercentage: 20,
    note: `Monatsrechnung für ${previousMonthName} ${previousMonthYear}`
  })

  async function onSubmit(event: FormSubmitEvent<Schema>) {
    console.log('call endpoint')
    toast.add({
      title: 'Rechnung erfolgreich erstellt!'
    })
  }
</script>

<template>
  <UPageCard>
    <template #title> Bexio-Rechnung erstellen </template>
    <UForm :schema="schema" :state="state" @submit="onSubmit">
      <div class="grid grid-cols-12 gap-4 items-end">
        <UFormField label="Anzahl Stunden" name="amount" class="col-span-12">
          <UInput v-model="state.amount" />
        </UFormField>
        <UFormField
          label="Stundensatz (chf)"
          name="hourlyRate"
          class="col-span-12"
        >
          <UInput v-model="state.hourlyRate" />
        </UFormField>
        <UFormField
          label="Prozente We.Publish"
          name="wepPercentage"
          class="col-span-12"
        >
          <UInput v-model="state.wepPercentage" />
        </UFormField>
        <UFormField label="Notiz" name="note" class="col-span-12">
          <UTextarea v-model="state.note" :cols="100" />
        </UFormField>
        <UButton type="submit" size="xl" class="col-span-4">
          Rechnung erstellen
        </UButton>
      </div>
    </UForm>
  </UPageCard>
</template>

<style></style>
