<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent, TabsItem } from '@nuxt/ui'
  import type { InvoicesStatic } from 'bexio'
  import { CalendarDate } from '@internationalized/date'

  const toast = useToast()
  const route = useRoute()
  const router = useRouter()
  const directus = useDirectus()
  const userStore = useUserStore()
  const topUpsComp = useTopUps()
  const financeCalc = useFinanceCalculations()

  const hours = computed<number | undefined>(() =>
    route.query?.hours ? Number(route.query.hours) : undefined
  )
  const amount = ref<number | undefined>(
    route.query?.amount ? Number(route.query.amount) : undefined
  )
  const quarter = ref<number | undefined>(undefined)
  const year = ref<number>(new Date().getFullYear())
  const billingDate = ref<CalendarDate>(
    new CalendarDate(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      new Date().getDate()
    )
  )
  const inputDate = useTemplateRef('inputDate')

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
    wepPercentage: z.coerce.number('Prozent für We.Share eingeben'),
    note: z.string('Bemerkung eingeben'),
    billingDate: z.any()
  })

  type Schema = z.output<typeof schema>

  const state = reactive<Partial<Schema>>({
    title: '',
    hours: hours.value,
    hourlyRate: 150,
    wepPercentage: 20,
    note: ''
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

  const toalPriceWithoutVat = computed<number>(
    () => totalHoursWithWepPercentage.value * (state.hourlyRate || 0)
  )

  const totalVat = computed<number>(
    () => Math.round(toalPriceWithoutVat.value * 0.081 * 100) / 100
  )

  const totalPriceWithVat = computed<number>(
    () => toalPriceWithoutVat.value + totalVat.value
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

  const showAmountDeviation = computed<boolean>(
    () => prePaid.value && Number(amount.value) !== toalPriceWithoutVat.value
  )

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
          wepPercentage: state.wepPercentage!,
          billingDate: billingDate.value.toString()
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
      // only update if in prePaid mode
      if (prePaid.value) {
        // get hours from amount
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

  const todayText = new Date().toLocaleDateString('de', { dateStyle: 'medium' })

  // update texts depending on tab
  watch(
    [tab, quarter, year],
    () => {
      billingDate.value = getBillingDateByQuarter()
      if (prePaid.value) {
        state.hourlyRate = 120
        state.title = `We.Develop Prepaid ${quarter.value || '[QUARTAL]'}. Quartal ${year.value}`
        state.note = `We.Develop in Prepaid gemäss vertraglicher Vereinbarung. ${quarter.value || '[QUARTAL]'}. Quartal ${year.value}. Abrechnungsdetails siehe Dashboard We.Publish ONE`
      }
      if (postPaid.value) {
        state.hourlyRate = 150
        state.title = `Abrechnung per ${todayText}`
        state.note = `Abrechnung erbrachter Leistungen durch das We.Publish-Team per ${todayText}. Profitiere von einem vergünstigten Tarif indem du vorauszahlst. Melde Dich bei deiner Ansprechperson von We.Publish. Das detaillierte Arbeitsprotokoll findest Du hier: https://one.wepublish.cloud`
      }
    },
    {
      immediate: true
    }
  )

  function getBillingDateByQuarter(): CalendarDate {
    let tmpBd = new Date()

    if (quarter.value && year.value && prePaid.value) {
      switch (Number(quarter.value)) {
        case 1:
          // return 15th of January >> payment by 15th of Feb.
          tmpBd = new Date(year.value, 0, 15)
          break
        case 2:
          tmpBd = new Date(year.value, 3, 15)
          break
        case 3:
          tmpBd = new Date(year.value, 6, 15)
          break
        case 4:
          tmpBd = new Date(year.value, 9, 15)
          break
        default:
          tmpBd = new Date()
      }
    }

    return new CalendarDate(
      tmpBd.getFullYear(),
      tmpBd.getMonth() + 1,
      tmpBd.getDate()
    )
  }
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

    <div v-if="prePaid" class="grid grid-cols-12 gap-4 items-start">
      <div class="col-span-2">
        <UFormField label="Jahr" name="quarter">
          <UInput v-model="year" class="w-full" />
        </UFormField>
      </div>
      <div class="col-span-2">
        <UFormField label="Quartal" name="quarter">
          <UInput v-model="quarter" class="w-full" />
        </UFormField>
      </div>
    </div>

    <UForm :schema="schema" :state="state" @submit="onSubmit">
      <div class="grid grid-cols-12 gap-12 items-start pt-10">
        <div class="col-span-6 grid grid-cols-12 gap-4">
          <UFormField
            label="Rechnungsdatum"
            name="billingDate"
            class="col-span-12"
          >
            {{
              new Date(billingDate.toString()).toLocaleDateString('de', {
                dateStyle: 'medium'
              })
            }}

            <UPopover :reference="inputDate?.inputsRef[3]?.$el">
              <UButton
                size="xs"
                icon="i-lucide-calendar"
                class="ml-2"
                variant="outline"
                >Datum wählen</UButton
              >
              <template #content>
                <UCalendar v-model="billingDate" />
              </template>
            </UPopover>
          </UFormField>
          <UFormField label="Rechnungstitel" name="title" class="col-span-12">
            <UInput v-model="state.title" class="w-full" />
          </UFormField>
          <UFormField
            v-if="prePaid"
            label="Pauschaler Rechnungsbetrag (CHF)"
            name="amount"
            class="col-span-6"
          >
            <UInput v-model="amount" class="w-full" />
          </UFormField>
          <UFormField
            v-if="postPaid"
            label="Anzahl Stunden"
            name="hours"
            class="col-span-6"
          >
            <UInput v-model="state.hours" class="w-full" />
          </UFormField>
          <UFormField
            label="Stundensatz (chf)"
            name="hourlyRate"
            class="col-span-6"
          >
            <UInput v-model="state.hourlyRate" class="w-full" />
          </UFormField>
          <UFormField
            label="We.Share Prozente"
            name="wepPercentage"
            class="col-span-6"
          >
            <UInput v-model="state.wepPercentage" class="w-full" />
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

          <div class="grid grid-cols-12 pt-8">
            <div
              class="col-span-6"
              :class="{ 'text-error': showAmountDeviation }"
            >
              Total ohne MwSt.
            </div>
            <div
              class="col-span-6 text-end"
              :class="{ 'text-error': showAmountDeviation }"
            >
              {{ toalPriceWithoutVat }} CHF
            </div>

            <div v-if="showAmountDeviation" class="col-span-12 pb-2">
              <UAlert
                color="error"
                variant="soft"
                icon="mdi:flash-triangle-outline"
              >
                <template #title>Angepasster Rechnungsbetrag</template>
                <template #description
                  >Der Rechnungsbetrag wurde aufgrund von Rundungsregeln
                  automatisch angepasst.</template
                >
              </UAlert>
            </div>
            <div class="col-span-6">MwSt.</div>
            <div class="col-span-6 text-end">{{ totalVat }} CHF</div>
          </div>

          <div class="grid grid-cols-12 py-2 border-b border-t">
            <div class="col-span-6 font-bold">Total mit MwSt.</div>
            <div class="col-span-6 font-bold text-end">
              {{ totalPriceWithVat }} CHF
            </div>
          </div>

          <div class="grid grid-cols-12"></div>
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
