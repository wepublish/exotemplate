<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent, TabsItem } from '@nuxt/ui'
  import type { InvoicesStatic } from 'bexio'

  const toast = useToast()
  const route = useRoute()
  const router = useRouter()
  const directus = useDirectus()
  const userStore = useUserStore()
  const topUpsComp = useTopUps()
  const financeCalc = useFinanceCalculations()

  const todayText = new Date().toLocaleDateString('de', { dateStyle: 'medium' })

  const hours = computed<number | undefined>(() =>
    route.query?.hours ? Number(route.query.hours) : undefined
  )
  const amount = ref<number | undefined>(
    route.query?.amount ? Number(route.query.amount) : undefined
  )

  const clientPeriodId = computed<number | undefined>(() => {
    const clientPeriodId = route.params?.clientPeriodId
    if (!clientPeriodId) return
    return Number(clientPeriodId)
  })

  const tabs: TabsItem[] = [
    {
      label: 'Post-Paid (Stundenbasiert)',
      icon: 'mdi:watch',
      slot: 'postPaid',
      value: 'postPaid'
    },
    {
      label: 'Pre-Paid (Betragsbasiert)',
      icon: 'mdi:bird',
      slot: 'prePaid',
      value: 'prePaid'
    }
  ]
  const tab = ref<'postPaid' | 'prePaid'>(hours.value ? 'postPaid' : 'prePaid')

  const postPaid = computed<boolean>(() => tab.value === 'postPaid')
  const prePaid = computed<boolean>(() => tab.value === 'prePaid')

  const schema = z.object({
    title: z.string('Rechnungstitel eingeben'),
    hours: z.coerce.number('Anzahl Stunden eingeben'),
    hourlyRate: z.coerce.number('Stundensatz eingeben'),
    wepPercentage: z.coerce.number('Prozent für We.Publish eingeben'),
    note: z.string('Bemerkung eingeben')
  })

  type Schema = z.output<typeof schema>

  const state = reactive<Partial<Schema>>({
    title: `Abrechnung per ${todayText}`,
    hours: hours.value,
    hourlyRate: 150,
    wepPercentage: 20,
    note: `Abrechnung erbrachter Leistungen durch das We.Publish-Team per ${todayText}. Profitiere von einem vergünstigten Tarif indem du vorauszahlst. Melde Dich bei deiner Ansprechperson von We.Publish. Das detaillierte Arbeitsprotokoll findest Du hier: https://one.wepublish.cloud`
  })

  const loading = ref<boolean>(false)

  const createdBexioInvoice = ref<InvoicesStatic.Invoice | undefined>(undefined)
  const createdTopUpId = ref<string | undefined>(undefined)

  const totalHoursWithWepPercentage = computed<number>(() =>
    financeCalc.getHoursWithWepPercentageOnTop(state.hours, state.wepPercentage)
  )

  const wePublishHours = computed<number>(
    () => totalHoursWithWepPercentage.value - (state.hours || 0)
  )
  const toalPrice = computed<number>(
    () => totalHoursWithWepPercentage.value * (state.hourlyRate || 0)
  )

  const bexioInvoiceUrl = computed<string | undefined>(() => {
    if (!createdBexioInvoice.value) {
      return
    }
    return topUpsComp.getBexioInvoiceUrl(createdBexioInvoice.value?.id)
  })
  const topUpUrl = computed<string | undefined>(() => {
    if (!createdTopUpId.value) return
    return `${directus.API_URL()}/admin/content/TopUps/${createdTopUpId.value}`
  })

  async function onSubmit(event: FormSubmitEvent<Schema>) {
    try {
      loading.value = true
      const { bexioInvoice, topUpId } = (
        await directus.postCustomEndpoint('invoice-with-topup', {
          clientPeriodId: clientPeriodId.value!,
          title: state.title!,
          text: state.note!,
          amount: totalHoursWithWepPercentage.value,
          unit_price: state.hourlyRate!,
          wepPercentage: state.wepPercentage!
        })
      ).data as { bexioInvoice: InvoicesStatic.Invoice; topUpId: string }

      createdBexioInvoice.value = bexioInvoice
      createdTopUpId.value = topUpId

      await userStore.loadUserData()

      toast.add({
        title: 'Rechnung erfolgreich erstellt!'
      })
    } catch (error) {
      toast.add({
        color: 'error',
        title: (error as any).toString()
      })
    } finally {
      loading.value = false
    }
  }

  // update hours if amount or state changes
  watch(
    [state, amount],
    () => {
      // only update if tab is on prepaid
      if (prePaid.value) {
        state.hours = financeCalc.getHoursByAmount(
          amount.value,
          state.hourlyRate,
          state.wepPercentage
        ).clientHours
      }
    },
    {
      immediate: true
    }
  )
</script>

<template>
  <UButton
    icon="material-symbols:arrow-back-ios"
    variant="ghost"
    size="sm"
    class="mb-4"
    @click="router.back()"
  >
    Zurück
  </UButton>
  <UPageCard>
    <template #title> Bexio-Rechnung erstellen </template>
    <UTabs :items="tabs" v-model="tab" />

    <template #description>
      <p>Hier kannst Du automatisch eine Bexio-Rechnung erstellen.</p>
      <p>
        Eine Zahlung / Top-Up wird im One-Dashboard automatisch hinzugefügt und
        mit der Bexio-Rechnung verknüpft.
      </p>
      <p v-if="postPaid" class="font-bold">
        Zu deinen Stunden wird automatisch der We.Publish-Genossenschaftsbeitrag
        hinzugerechnet.
      </p>
    </template>

    <UForm :schema="schema" :state="state" @submit="onSubmit">
      <div class="grid grid-cols-12 gap-4 items-start pt-10">
        <div class="col-span-6 grid grid-cols-12 gap-4">
          <UFormField label="Rechnungstitel" name="title" class="col-span-12">
            <UInput v-model="state.title" class="w-3/4" />
          </UFormField>
          <UFormField
            v-if="prePaid"
            label="Pauschaler Rechnungsbetrag (CHF)"
            name="amount"
            class="col-span-12"
          >
            <UInput v-model="amount" class="w-3/4" />
          </UFormField>
          <UFormField
            v-if="postPaid"
            label="Anzahl Stunden in Rechnung stellen"
            name="hours"
            class="col-span-12"
          >
            <UInput v-model="state.hours" class="w-3/4" />
          </UFormField>
          <UFormField
            label="Stundensatz (chf)"
            name="hourlyRate"
            class="col-span-12"
          >
            <UInput v-model="state.hourlyRate" class="w-3/4" />
          </UFormField>
          <UFormField
            label="Prozente We.Publish"
            name="wepPercentage"
            class="col-span-12"
          >
            <UInput v-model="state.wepPercentage" class="w-3/4" />
          </UFormField>
          <UFormField
            label="Beschreibung Position"
            name="note"
            class="col-span-12"
          >
            <UTextarea v-model="state.note" :rows="5" class="w-full" />
          </UFormField>
          <UButton
            v-if="!createdBexioInvoice"
            type="submit"
            size="xl"
            class="col-span-6 mt-8"
            icon="material-symbols:sheets-add-on"
            :loading="loading"
          >
            Rechnung erstellen
          </UButton>
        </div>

        <!-- preview -->
        <div class="col-span-6">
          <div class="col-span-12 font-bold pb-4">Vorschau Rechnung</div>

          <div class="grid grid-cols-12">
            <div class="col-span-6">Stunden abzurechnen:</div>
            <div class="col-span-6 text-end">{{ state.hours }} h</div>
            <div class="col-span-6 border-b">
              Genossenschaftsanteil We.Publish
            </div>
            <div class="col-span-6 border-b text-end">
              {{ wePublishHours }} h
            </div>
            <div class="col-span-6 font-bold">Total Stunden</div>
            <div class="col-span-6 font-bold text-end">
              {{ totalHoursWithWepPercentage }} h
            </div>
          </div>

          <div class="grid grid-cols-12">
            <div class="col-span-6 font-bold pt-8">Total Rechnungsbetrag</div>
            <div class="col-span-6 font-bold text-end pt-8">
              {{ toalPrice }} CHF
            </div>
          </div>

          <UAlert
            v-if="amount !== toalPrice"
            color="error"
            variant="soft"
            icon="mdi:flash-triangle-outline"
            class="mt-4"
          >
            <template #title>Angepasster Rechnungsbetrag</template>
            <template #description
              >Der Rechnungsbetrag wurde aufgrund von Rundungsregeln automatisch
              angepasst.</template
            >
          </UAlert>
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
