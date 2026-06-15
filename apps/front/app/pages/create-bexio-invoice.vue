<script lang="ts" setup>
  import * as z from 'zod'
  import type { FormSubmitEvent, TabsItem } from '@nuxt/ui'
  import type { InvoicesStatic, OrdersStatic } from 'bexio'
  import { CalendarDate } from '@internationalized/date'

  const toast = useToast()
  const route = useRoute()
  const router = useRouter()
  const directus = useDirectus()
  const userStore = useUserStore()
  const topUpsComp = useTopUps()
  const link = useClientPeriodLink()
  const invoicesComp = useInvoices()
  const financeCalc = useFinanceCalculations()
  const { t } = useI18n()
  const { formatDate, formatNumber } = useFormatters()

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
  // UCalendar can emit a nullish value (e.g. on internal re-init with a
  // CalendarDate from a skewed @internationalized/date version). Ignore those
  // so `billingDate` is never undefined — the date display + submit rely on it.
  function onBillingDateChange(value: any): void {
    if (value) billingDate.value = value as CalendarDate
  }
  const inputDate = useTemplateRef('inputDate')

  const clientPeriodId = computed<number | undefined>(() => {
    const clientPeriodId = route.params?.clientPeriodId
    if (!clientPeriodId) return
    return Number(clientPeriodId)
  })

  const tabs = computed<TabsItem[]>(() => [
    {
      label: t('billing.createInvoice.tabs.postPaid'),
      icon: 'mdi:watch',
      slot: 'postPaid',
      value: 'postPaid'
    },
    {
      label: t('billing.createInvoice.tabs.prePaid'),
      icon: 'mdi:bird',
      slot: 'prePaid',
      value: 'prePaid'
    },
    {
      label: t('billing.createInvoice.tabs.hosting'),
      icon: 'lucide:refresh-cw',
      slot: 'hosting',
      value: 'hosting'
    }
  ])
  const queryTab = computed<'postPaid' | 'prePaid' | 'hosting' | undefined>(
    () => {
      const q = route.query?.tab
      return q === 'postPaid' || q === 'prePaid' || q === 'hosting'
        ? q
        : undefined
    }
  )
  const tab = ref<'postPaid' | 'prePaid' | 'hosting'>(
    queryTab.value ?? (hours.value ? 'postPaid' : 'prePaid')
  )

  const postPaid = computed<boolean>(() => tab.value === 'postPaid')
  const prePaid = computed<boolean>(() => tab.value === 'prePaid')
  const hosting = computed<boolean>(() => tab.value === 'hosting')

  const schema = z.object({
    title: z.string(t('billing.createInvoice.validation.title')),
    hours: z.coerce.number(t('billing.createInvoice.validation.hours')),
    hourlyRate: z.coerce.number(
      t('billing.createInvoice.validation.hourlyRate')
    ),
    wepPercentage: z.coerce.number(
      t('billing.createInvoice.validation.wepPercentage')
    ),
    note: z.string(t('billing.createInvoice.validation.note'))
    // `billingDate` is intentionally NOT in the schema: it's a standalone ref
    // (the calendar), not part of `state`. Listing it as `z.any()` made the
    // form require the key, which now fails validation ("expected nonoptional,
    // received undefined") and blocks submit.
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

  // --- Hosting (recurring) invoice — deliberately separate state + flow so the
  // amount-only hosting math never mixes with the hour-based calculation above.
  const hostingSchema = z.object({
    title: z.string(t('billing.createInvoice.validation.title')),
    unitPrice: z.coerce.number(t('billing.createInvoice.validation.unitPrice')),
    quantity: z.coerce.number(
      t('billing.createInvoice.validation.billedUnits')
    ),
    billedUnits: z.coerce.number(
      t('billing.createInvoice.validation.billedUnits')
    ),
    note: z.string(t('billing.createInvoice.validation.note'))
  })
  type HostingSchema = z.output<typeof hostingSchema>

  const hostingYear = ref<number>(new Date().getFullYear())
  const hostingState = reactive<Partial<HostingSchema>>({
    title: t('billing.createInvoice.defaults.hostingTitle'),
    note: t('billing.createInvoice.defaults.hostingNote'),
    unitPrice: 390,
    quantity: 12,
    billedUnits: undefined
  })
  const hostingPeriodicity = 'yearly'

  const loadingHosting = ref<boolean>(false)
  const createdHostingOrder = ref<OrdersStatic.OrderSmall | undefined>(
    undefined
  )
  const createdHostingInvoice = ref<InvoicesStatic.Invoice | undefined>(
    undefined
  )

  const hostingOrderAnnualTotal = computed<number>(() =>
    financeCalc.getHostingOrderAnnualTotal(
      hostingState.unitPrice,
      hostingState.quantity
    )
  )
  const hostingTotals = computed(() =>
    financeCalc.getHostingInvoiceTotals(
      hostingState.unitPrice,
      hostingState.billedUnits
    )
  )
  const hostingBexioInvoiceUrl = computed<string | undefined>(() =>
    createdHostingInvoice.value
      ? topUpsComp.getBexioInvoiceUrl(createdHostingInvoice.value.id)
      : undefined
  )
  const hostingBexioOrderUrl = computed<string | undefined>(() =>
    createdHostingOrder.value
      ? topUpsComp.getBexioOrderUrl(createdHostingOrder.value.id)
      : undefined
  )

  async function onSubmitHosting() {
    try {
      loadingHosting.value = true
      const { bexioOrder, bexioInvoice } =
        await invoicesComp.createHostingInvoice({
          clientPeriodId: clientPeriodId.value!,
          type: 'hosting',
          title: hostingState.title!,
          text: hostingState.note!,
          unitPrice: Number(hostingState.unitPrice),
          quantity: Number(hostingState.quantity),
          billedUnits: Number(hostingState.billedUnits),
          periodicity: hostingPeriodicity,
          billingDate: billingDate.value.toString(),
          orderDate: `${hostingYear.value}-12-31`
        })

      createdHostingOrder.value = bexioOrder
      createdHostingInvoice.value = bexioInvoice

      await userStore.loadUserData()

      toast.add({ title: t('billing.createInvoice.successTitle') })
    } catch (error) {
      toast.add({ color: 'error', title: (error as any).toString() })
    } finally {
      loadingHosting.value = false
    }
  }

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
        title: t('billing.createInvoice.successTitle')
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

  const todayText = computed(() => formatDate(new Date()))

  // update texts depending on tab
  watch(
    [tab, quarter, year],
    () => {
      billingDate.value = getBillingDateByQuarter()
      const quarterText =
        quarter.value || t('billing.createInvoice.defaults.quarterPlaceholder')
      if (prePaid.value) {
        state.hourlyRate = 120
        state.title = t('billing.createInvoice.defaults.prePaidTitle', {
          quarter: quarterText,
          year: year.value
        })
        state.note = t('billing.createInvoice.defaults.prePaidNote', {
          quarter: quarterText,
          year: year.value
        })
      }
      if (postPaid.value) {
        state.hourlyRate = 150
        state.title = t('billing.createInvoice.defaults.postPaidTitle', {
          date: todayText.value
        })
        state.note = t('billing.createInvoice.defaults.postPaidNote', {
          date: todayText.value
        })
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
    icon="lucide:chevron-left"
    variant="ghost"
    size="sm"
    class="mb-4"
    @click="router.back()"
  >
    {{ t('common.back') }}
  </UButton>
  <UPageCard>
    <template #title> {{ t('billing.createInvoice.pageTitle') }} </template>
    <UTabs :items="tabs" v-model="tab" />

    <template #description>
      <p>{{ t('billing.createInvoice.intro') }}</p>
      <p v-if="!hosting">{{ t('billing.createInvoice.introTopUpLink') }}</p>
      <p v-if="hosting">{{ t('billing.createInvoice.hostingIntro') }}</p>
      <p v-if="postPaid" class="font-bold">
        {{ t('billing.createInvoice.introCooperativeFee') }}
      </p>
    </template>

    <div v-if="prePaid" class="grid grid-cols-12 gap-4 items-start">
      <div class="col-span-2">
        <UFormField
          :label="t('billing.createInvoice.fields.year')"
          name="quarter"
        >
          <UInput v-model="year" class="w-full" />
        </UFormField>
      </div>
      <div class="col-span-2">
        <UFormField
          :label="t('billing.createInvoice.fields.quarter')"
          name="quarter"
        >
          <UInput v-model="quarter" class="w-full" />
        </UFormField>
      </div>
    </div>

    <UForm v-if="!hosting" :schema="schema" :state="state" @submit="onSubmit">
      <div class="grid grid-cols-12 gap-12 items-start pt-10">
        <div class="col-span-6 grid grid-cols-12 gap-4">
          <UFormField
            :label="t('billing.createInvoice.fields.billingDate')"
            name="billingDate"
            class="col-span-12"
          >
            {{ billingDate ? formatDate(billingDate.toString()) : '' }}

            <UPopover :reference="inputDate?.inputsRef[3]?.$el">
              <UButton
                size="xs"
                icon="lucide:calendar"
                class="ml-2"
                variant="outline"
                >{{ t('billing.createInvoice.pickDate') }}</UButton
              >
              <template #content>
                <UCalendar
                  :model-value="billingDate"
                  @update:model-value="onBillingDateChange"
                />
              </template>
            </UPopover>
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.title')"
            name="title"
            class="col-span-12"
          >
            <UInput v-model="state.title" class="w-full" />
          </UFormField>
          <UFormField
            v-if="prePaid"
            :label="t('billing.createInvoice.fields.amount')"
            name="amount"
            class="col-span-6"
          >
            <UInput v-model="amount" class="w-full" />
          </UFormField>
          <UFormField
            v-if="postPaid"
            :label="t('billing.createInvoice.fields.hours')"
            name="hours"
            class="col-span-6"
          >
            <UInput v-model="state.hours" class="w-full" />
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.hourlyRate')"
            name="hourlyRate"
            class="col-span-6"
          >
            <UInput v-model="state.hourlyRate" class="w-full" />
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.wepPercentage')"
            name="wepPercentage"
            class="col-span-6"
          >
            <UInput v-model="state.wepPercentage" class="w-full" />
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.note')"
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
            icon="lucide:sheet"
            :loading="loading"
          >
            {{ t('billing.createInvoice.submit') }}
          </UButton>
        </div>

        <!-- preview -->
        <div class="col-span-6">
          <div class="col-span-12 font-bold pb-4">
            {{ t('billing.createInvoice.preview.title') }}
          </div>

          <div class="grid grid-cols-12">
            <div class="col-span-6">
              {{ t('billing.createInvoice.preview.hoursToBill') }}
            </div>
            <div class="col-span-6 text-end">
              {{ formatNumber(state.hours) }} h
            </div>
            <div class="col-span-6 border-b">
              {{ t('billing.createInvoice.preview.cooperativeShare') }}
            </div>
            <div class="col-span-6 border-b text-end">
              {{ formatNumber(wePublishHours) }} h
            </div>
            <div class="col-span-6 font-bold">
              {{ t('billing.createInvoice.preview.totalHours') }}
            </div>
            <div class="col-span-6 font-bold text-end">
              {{ formatNumber(totalHoursWithWepPercentage) }} h
            </div>
          </div>

          <div class="grid grid-cols-12 pt-8">
            <div
              class="col-span-6"
              :class="{ 'text-error': showAmountDeviation }"
            >
              {{ t('billing.createInvoice.preview.totalWithoutVat') }}
            </div>
            <div
              class="col-span-6 text-end"
              :class="{ 'text-error': showAmountDeviation }"
            >
              {{
                formatNumber(toalPriceWithoutVat, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })
              }}
              CHF
            </div>

            <div v-if="showAmountDeviation" class="col-span-12 pb-2">
              <UAlert
                color="error"
                variant="soft"
                icon="mdi:flash-triangle-outline"
              >
                <template #title>{{
                  t('billing.createInvoice.deviationTitle')
                }}</template>
                <template #description>{{
                  t('billing.createInvoice.deviationDescription')
                }}</template>
              </UAlert>
            </div>
            <div class="col-span-6">
              {{ t('billing.createInvoice.preview.vat') }}
            </div>
            <div class="col-span-6 text-end">
              {{
                formatNumber(totalVat, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })
              }}
              CHF
            </div>
          </div>

          <div class="grid grid-cols-12 py-2 border-b border-t">
            <div class="col-span-6 font-bold">
              {{ t('billing.createInvoice.preview.totalWithVat') }}
            </div>
            <div class="col-span-6 font-bold text-end">
              {{
                formatNumber(totalPriceWithVat, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })
              }}
              CHF
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
            <UAlert color="success" icon="lucide:check">
              <template #title>
                {{ t('billing.createInvoice.successCardTitle') }}
              </template>
              <template #description>
                {{ t('billing.createInvoice.successCardDescription') }}
              </template>
            </UAlert>
          </div>

          <div class="col-span-6 grid grid-cols-12 gap-4 items-end">
            <div class="col-span-6">
              <UButton
                :to="link('/dashboard')"
                icon="lucide:chevron-left"
                variant="link"
                size="xl"
              >
                {{ t('billing.backToDashboard') }}
              </UButton>
            </div>
            <div class="col-span-6">
              <UButton
                :href="bexioInvoiceUrl"
                target="_blank"
                trailing-icon="lucide:external-link"
                size="xl"
              >
                {{ t('billing.createInvoice.openBexioInvoice') }}
              </UButton>
              <br />
              <UButton
                :href="topUpUrl"
                variant="link"
                target="_blank"
                trailing-icon="lucide:external-link"
                size="xl"
                class="mt-4"
              >
                {{ t('billing.createInvoice.openDirectusTopUp') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </UForm>

    <!-- Hosting (recurring) — separate form + preview + success -->
    <UForm
      v-if="hosting"
      :schema="hostingSchema"
      :state="hostingState"
      @submit="onSubmitHosting"
    >
      <div class="grid grid-cols-12 gap-12 items-start pt-10">
        <div class="col-span-6 grid grid-cols-12 gap-4">
          <UFormField
            :label="t('billing.createInvoice.fields.billingDate')"
            name="billingDate"
            class="col-span-12"
          >
            {{ billingDate ? formatDate(billingDate.toString()) : '' }}
            <UPopover>
              <UButton
                size="xs"
                icon="lucide:calendar"
                class="ml-2"
                variant="outline"
                >{{ t('billing.createInvoice.pickDate') }}</UButton
              >
              <template #content>
                <UCalendar
                  :model-value="billingDate"
                  @update:model-value="onBillingDateChange"
                />
              </template>
            </UPopover>
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.year')"
            name="year"
            class="col-span-6"
          >
            <UInput v-model="hostingYear" class="w-full" />
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.title')"
            name="title"
            class="col-span-12"
          >
            <UInput v-model="hostingState.title" class="w-full" />
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.unitPrice')"
            name="unitPrice"
            class="col-span-6"
          >
            <UInput v-model="hostingState.unitPrice" class="w-full" />
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.quantity')"
            name="quantity"
            class="col-span-6"
          >
            <UInput v-model="hostingState.quantity" class="w-full" />
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.billedUnits')"
            name="billedUnits"
            class="col-span-6"
          >
            <UInput v-model="hostingState.billedUnits" class="w-full" />
          </UFormField>
          <UFormField
            :label="t('billing.createInvoice.fields.note')"
            name="note"
            class="col-span-12"
          >
            <UTextarea v-model="hostingState.note" :rows="4" class="w-full" />
          </UFormField>
          <UButton
            v-if="!createdHostingInvoice"
            type="submit"
            size="xl"
            class="col-span-6 mt-8"
            icon="lucide:sheet"
            :loading="loadingHosting"
          >
            {{ t('billing.createInvoice.submit') }}
          </UButton>
        </div>

        <!-- preview: two clearly-separated Bexio artifacts -->
        <div class="col-span-6 space-y-5">
          <!-- Step 1 · the recurring ORDER (Auftrag) -->
          <div class="rounded-lg border border-default p-4">
            <div class="flex items-center gap-2">
              <UIcon name="lucide:refresh-cw" class="text-primary size-5" />
              <span class="font-bold">
                {{ t('billing.createInvoice.preview.orderSectionTitle') }}
              </span>
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
                class="ms-auto"
              >
                {{ t('billing.createInvoice.preview.periodicityYearly') }}
              </UBadge>
            </div>
            <p class="text-xs text-muted mt-1 mb-3">
              {{ t('billing.createInvoice.preview.orderSectionSubtitle') }}
            </p>
            <div class="grid grid-cols-12 gap-y-1">
              <div class="col-span-7">
                {{ t('billing.createInvoice.preview.unitPriceLine') }}
              </div>
              <div class="col-span-5 text-end">
                {{
                  formatNumber(hostingState.unitPrice, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })
                }}
                CHF
              </div>
              <div class="col-span-7">
                {{ t('billing.createInvoice.preview.quantityLine') }}
              </div>
              <div class="col-span-5 text-end">
                {{ formatNumber(hostingState.quantity) }}
              </div>
              <div class="col-span-7 font-bold border-t pt-1">
                {{ t('billing.createInvoice.preview.hostingAnnualTotal') }}
              </div>
              <div class="col-span-5 font-bold text-end border-t pt-1">
                {{
                  formatNumber(hostingOrderAnnualTotal, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })
                }}
                CHF
              </div>
            </div>
          </div>

          <!-- arrow / relation hint -->
          <div
            class="flex items-center justify-center gap-2 text-xs text-muted"
          >
            <UIcon name="lucide:corner-down-right" class="size-4" />
            {{ t('billing.createInvoice.preview.orderToInvoiceHint') }}
          </div>

          <!-- Step 2 · the first INVOICE (Rechnung) generated from the order -->
          <div class="rounded-lg border-2 border-primary p-4 bg-primary/5">
            <div class="flex items-center gap-2">
              <UIcon name="lucide:receipt" class="text-primary size-5" />
              <span class="font-bold">
                {{ t('billing.createInvoice.preview.invoiceSectionTitle') }}
              </span>
            </div>
            <p class="text-xs text-muted mt-1 mb-3">
              {{ t('billing.createInvoice.preview.invoiceSectionSubtitle') }}
            </p>
            <div class="grid grid-cols-12 gap-y-1">
              <div class="col-span-7">
                {{ t('billing.createInvoice.preview.monthsToBill') }}
              </div>
              <div class="col-span-5 text-end">
                {{ formatNumber(hostingState.billedUnits) }} /
                {{ formatNumber(hostingState.quantity) }}
              </div>
              <div class="col-span-7">
                {{ t('billing.createInvoice.preview.totalWithoutVat') }}
              </div>
              <div class="col-span-5 text-end">
                {{
                  formatNumber(hostingTotals.net, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })
                }}
                CHF
              </div>
              <div class="col-span-7">
                {{ t('billing.createInvoice.preview.vat') }}
              </div>
              <div class="col-span-5 text-end">
                {{
                  formatNumber(hostingTotals.vat, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })
                }}
                CHF
              </div>
              <div class="col-span-7 font-bold border-t pt-1">
                {{ t('billing.createInvoice.preview.totalWithVat') }}
              </div>
              <div class="col-span-5 font-bold text-end border-t pt-1">
                {{
                  formatNumber(hostingTotals.gross, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })
                }}
                CHF
              </div>
            </div>
          </div>
        </div>

        <!-- hosting invoice was created -->
        <div
          v-if="createdHostingInvoice"
          class="col-span-12 grid grid-cols-12 gap-8 items-end"
        >
          <div class="col-span-6">
            <UAlert color="success" icon="lucide:check">
              <template #title>
                {{ t('billing.createInvoice.successCardTitle') }}
              </template>
              <template #description>
                {{ t('billing.createInvoice.hostingSuccessDescription') }}
              </template>
            </UAlert>
          </div>

          <div class="col-span-6 grid grid-cols-12 gap-4 items-end">
            <div class="col-span-6">
              <UButton
                :to="link('/dashboard')"
                icon="lucide:chevron-left"
                variant="link"
                size="xl"
              >
                {{ t('billing.backToDashboard') }}
              </UButton>
            </div>
            <div class="col-span-6">
              <UButton
                :href="hostingBexioInvoiceUrl"
                target="_blank"
                trailing-icon="lucide:external-link"
                size="xl"
              >
                {{ t('billing.createInvoice.openBexioInvoice') }}
              </UButton>
              <br />
              <UButton
                :href="hostingBexioOrderUrl"
                variant="link"
                target="_blank"
                trailing-icon="lucide:external-link"
                size="xl"
                class="mt-4"
              >
                {{ t('billing.createInvoice.openBexioOrder') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </UForm>
  </UPageCard>
</template>
