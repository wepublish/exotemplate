<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import type { InvoicesStatic } from 'bexio'
  import type { TopUp } from '~~/types/DirectusTypes'

  const toast = useToast()
  const route = useRoute()
  const directus = useDirectus()

  const todayText = new Date().toLocaleDateString('de', { dateStyle: 'medium' })

  const amount = computed<number | undefined>(() =>
    route.query?.amount ? Number(route.query.amount) : undefined
  )
  const clientPeriodId = computed<number | undefined>(() => {
    const clientPeriodId = route.params?.clientPeriodId
    if (!clientPeriodId) return
    return Number(clientPeriodId)
  })

  const schema = z.object({
    title: z.string('Rechnungstitel eingeben'),
    amount: z.number('Anzahl Stunden eingeben'),
    hourlyRate: z.number('Stundensatz eingeben'),
    wepPercentage: z.number('Prozent für We.Publish eingeben'),
    note: z.string('Bemerkung eingeben')
  })

  type Schema = z.output<typeof schema>

  const state = reactive<Partial<Schema>>({
    title: `Abrechnung per ${todayText}`,
    amount: amount.value,
    hourlyRate: 150,
    wepPercentage: 20,
    note: `Abrechnung erbrachter Leistungen durch das We.Publish-Team per ${todayText}. Profitiere von einem vergünstigten Tarif indem du vorauszahlst. Melde Dich bei deiner Ansprechperson von We.Publish. Das detaillierte Arbeitsprotokoll findest Du hier: https://one.wepublish.cloud`
  })

  const createdBexioInvoice = ref<InvoicesStatic.Invoice | undefined>(undefined)
  const createdTopUp = ref<TopUp | undefined>(undefined)

  const totalAmount = computed<number>(() => ((state.amount || 0) * 100) / 80)
  const wePublishAmount = computed<number>(() => totalAmount.value * 0.2)
  const toalPrice = computed<number>(
    () => totalAmount.value * (state.hourlyRate || 0)
  )

  const bexioInvoiceUrl = computed<string | undefined>(() => {
    if (!createdBexioInvoice.value) {
      return
    }
    return `https://office.bexio.com/index.php/kb_invoice/show/id/${createdBexioInvoice.value?.id}`
  })
  const topUpUrl = computed<string | undefined>(() => {
    if (!createdTopUp.value) return
    return `${directus.API_URL()}/admin/content/TopUps/${createdTopUp.value.id}`
  })

  async function onSubmit(event: FormSubmitEvent<Schema>) {
    try {
      const { bexioInvoice, topUp } = (
        await directus.postCustomEndpoint('invoice-with-topup', {
          clientPeriodId: clientPeriodId.value!,
          title: state.title!,
          text: state.note!,
          amount: totalAmount.value,
          unit_price: state.hourlyRate!,
          wepPercentage: state.wepPercentage!
        })
      ).data as { bexioInvoice: InvoicesStatic.Invoice; topUp: TopUp }

      createdBexioInvoice.value = bexioInvoice
      createdTopUp.value = topUp

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
    <template #description>
      <p class="max-w-1/2">
        Hier kannst Du automatisch eine Bexio-Rechnung erstellen. Zu deinen
        Stunden wird automatisch der We.Publish-Genossenschaftsbeitrag
        hinzugerechnet.
      </p>
      <p class="max-w-1/2 pt-2">
        Eine Zahlung / Top-Up wird im One-Dashboard automatisch hinzugefügt und
        mit der Bexio-Rechnung verknüpft.
      </p>
    </template>
    <UForm :schema="schema" :state="state" @submit="onSubmit">
      <div class="grid grid-cols-12 gap-4 items-start pt-10">
        <div class="col-span-6 grid grid-cols-12 gap-4">
          <UFormField label="Rechnungstitel" name="title" class="col-span-12">
            <UInput v-model="state.title" />
          </UFormField>
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
            label="Beschreibung Position"
            name="note"
            class="col-span-8"
          >
            <UTextarea v-model="state.note" :cols="100" />
          </UFormField>
          <UButton
            v-if="!createdBexioInvoice"
            type="submit"
            size="xl"
            class="col-span-6 mt-8"
            icon="material-symbols:sheets-add-on"
          >
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

        <!-- bexio invoice was created -->
        <div
          v-if="createdBexioInvoice"
          class="col-span-12 grid grid-cols-12 gap-8 items-end"
        >
          <div class="col-span-6">
            <UAlert color="success" icon="material-symbols:check-rounded">
              <template #title> Das hat geklappt! </template>
              <template #description>
                Eine Rechnung wurde auf Bexio erstellt und automatisch mit dem
                One-Dashboard verknüpft.
              </template>
            </UAlert>
          </div>

          <div class="col-span-6 grid grid-cols-12 gap-4 items-end">
            <div class="col-span-6">
              <UButton
                to="/"
                icon="material-symbols:arrow-back-ios"
                variant="link"
                size="xl"
              >
                Zurück zum Dashboard
              </UButton>
            </div>
            <div class="col-span-6">
              <UButton
                :href="bexioInvoiceUrl"
                target="_blank"
                trailing-icon="material-symbols:open-in-new-rounded"
                size="xl"
              >
                Bexio Rechnung öffnen
              </UButton>
              <br />
              <UButton
                :href="topUpUrl"
                variant="link"
                target="_blank"
                trailing-icon="material-symbols:open-in-new-rounded"
                size="xl"
                class="mt-4"
              >
                Directus Top-Up öffnen
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </UForm>
  </UPageCard>
</template>

<style></style>
