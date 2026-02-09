<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'

  const toast = useToast()
  const route = useRoute()
  const directus = useDirectus()

  const todayText = new Date().toLocaleDateString('de', { dateStyle: 'medium' })

  const amount = computed<number | undefined>(() =>
    route.query?.amount ? Number(route.query.amount) : undefined
  )

  const schema = z.object({
    amount: z.number('Anzahl Stunden eingeben'),
    hourlyRate: z.number('Stundensatz eingeben'),
    wepPercentage: z.number('Prozent für We.Publish eingeben'),
    note: z.optional(z.string('Bemerkung eingeben'))
  })

  type Schema = z.output<typeof schema>

  const state = reactive<Partial<Schema>>({
    amount: amount.value,
    hourlyRate: 150,
    wepPercentage: 20,
    note: `Abrechnung Leistungen per ${todayText}. Arbeitsprotokoll siehe https://one.wepublish.cloud`
  })

  const totalAmount = computed<number>(() => ((state.amount || 0) * 100) / 80)
  const wePublishAmount = computed<number>(() => totalAmount.value * 0.2)
  const toalPrice = computed<number>(
    () => totalAmount.value * (state.hourlyRate || 0)
  )

  async function onSubmit(event: FormSubmitEvent<Schema>) {
    try {
      const response = await directus.postCustomEndpoint(
        'invoice-with-topup',
        event.data
      )
      console.log(response)
      toast.add({
        title: 'Rechnung erfolgreich erstellt!'
      })
    } catch (error) {
      toast.add({
        color: 'error',
        title: (error as any).toString()
      })
    }
  }
</script>

<template>
  <UPageCard>
    <template #title> Bexio-Rechnung erstellen </template>
    <UForm :schema="schema" :state="state" @submit="onSubmit">
      <div class="grid grid-cols-12 gap-4 items-start">
        <div class="col-span-6 grid grid-cols-12 gap-4">
          <UFormField
            label="Anzahl Stunden in Rechnung stellen"
            name="amount"
            class="col-span-12"
          >
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
          <UFormField
            label="Rechnungsbeschreibung"
            name="note"
            class="col-span-8"
          >
            <UTextarea v-model="state.note" :cols="100" />
          </UFormField>
          <UButton type="submit" size="xl" class="col-span-6">
            Rechnung erstellen
          </UButton>
        </div>

        <!-- preview -->
        <div class="col-span-6 grid grid-cols-12">
          <div class="col-span-12 font-bold pb-4">Vorschau Rechnung</div>
          <div class="col-span-6">Stunden abzurechnen:</div>
          <div class="col-span-6 text-end">{{ state.amount }} h</div>
          <div class="col-span-6 border-b">
            Genossenschaftsanteil We.Publish
          </div>
          <div class="col-span-6 border-b text-end">
            {{ wePublishAmount }} h
          </div>
          <div class="col-span-6 font-bold">Total Stunden</div>
          <div class="col-span-6 font-bold text-end">{{ totalAmount }} h</div>

          <div class="col-span-6 font-bold pt-8">Total Rechnungsbetrag</div>
          <div class="col-span-6 font-bold text-end pt-8">
            {{ toalPrice }} CHF
          </div>
        </div>
      </div>
    </UForm>
  </UPageCard>
</template>

<style></style>
