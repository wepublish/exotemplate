<script lang="ts" setup>
  import type {
    BillingMode,
    Client,
    ClientPeriod,
    Invoice,
    Period
  } from '~~/types/DirectusTypes'
  import type { BexioInvoiceStatus } from '~/composables/useBexioInvoiceStatus'

  const route = useRoute()
  const userStore = useUserStore()
  const topUpsComp = useTopUps()
  const invoicesComp = useInvoices()
  const statusComp = useBexioInvoiceStatus()
  const toast = useToast()
  const { t } = useI18n()
  const { formatDate, formatNumber, formatHours } = useFormatters()
  const { setBillingMode } = useJiraWarnings()

  const billingModeOptions = computed<
    {
      value: BillingMode
      label: string
      description: string
    }[]
  >(() => [
    {
      value: 'prepaid',
      label: t('common.billingMode.prepaid'),
      description: t('billing.billingMode.prepaidDescription')
    },
    {
      value: 'monthly',
      label: t('common.billingMode.monthly'),
      description: t('billing.billingMode.monthlyDescription')
    }
  ])

  function billingModeLabel(mode: BillingMode | null | undefined): string {
    return (
      billingModeOptions.value.find((o) => o.value === mode)?.label ??
      t('common.billingMode.prepaid')
    )
  }

  const billingModePending = ref(false)

  const clientPeriodId = computed<number | undefined>(() => {
    const raw = route.params?.clientPeriodId
    if (!raw) return
    return Number(raw)
  })

  const {
    data: entryGroups,
    pending,
    error
  } = await useAggregatedHours(clientPeriodId)

  const sums = computed(() => entryGroups.value?.sums)

  const resolved = computed<{ client: Client; period: Period } | undefined>(
    () => {
      const id = clientPeriodId.value
      if (!id) return undefined
      for (const client of userStore.clients) {
        const periods = (client.periods || []) as ClientPeriod[]
        const match = periods.find((cp) => cp.id === id)
        if (match) return { client, period: match.Periods_id as Period }
      }
      return undefined
    }
  )

  const dashboardLink = computed(() =>
    clientPeriodId.value ? `/${clientPeriodId.value}/dashboard` : '/'
  )

  const formattedPeriod = computed(() => {
    const p = resolved.value?.period
    if (!p?.from || !p?.to) return ''
    return `${formatDate(p.from)} – ${formatDate(p.to)}`
  })

  const topUpsColumns = computed(() => [
    { accessorKey: 'Datum', header: t('billing.topUps.table.date') },
    { accessorKey: 'Notiz', header: t('billing.topUps.table.note') },
    { accessorKey: 'Betrag', header: t('billing.topUps.table.amount') },
    { accessorKey: 'Satz', header: t('billing.topUps.table.rate') },
    { accessorKey: 'Total', header: t('billing.topUps.table.total') },
    { accessorKey: 'WePublish', header: t('billing.topUps.table.wePublish') },
    { accessorKey: 'Medium', header: t('billing.topUps.table.medium') },
    { accessorKey: 'Bexio', header: t('billing.topUps.table.bexio') },
    { accessorKey: 'Status', header: t('billing.topUps.table.status') }
  ])

  const topUpsForTable = computed(() =>
    sums.value?.computedTopUps.map((topUp) => ({
      Datum: formatDate(topUp.date_created as string),
      Notiz: topUp.note || t('billing.topUps.emptyNote'),
      Betrag: `CHF ${formatNumber(topUp.amount, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`,
      Satz: t('billing.topUps.rateUnit', {
        rate: formatNumber(topUp.hourlyRate)
      }),
      Total: `${formatNumber(topUp.paidHours)} h`,
      WePublish: `${formatNumber(topUp.wepHours)} h`,
      Medium: `${formatNumber(topUp.clientHours)} h`,
      Bexio: topUp.bexioInvoiceId
    }))
  )

  // --- Hosting / recurring invoices (separate Invoices collection — NEVER part
  // of the available-hours sums above).
  const hostingInvoices = ref<Invoice[]>([])
  const statuses = ref<Record<number, BexioInvoiceStatus>>({})
  const orderLinks = ref<Record<number, string | null>>({})

  const isAdmin = computed(() => userStore.amIAdministrator())

  async function loadHostingInvoices(): Promise<void> {
    if (!clientPeriodId.value) return
    hostingInvoices.value = await invoicesComp.loadInvoices(
      clientPeriodId.value
    )
  }

  async function refreshStatuses(): Promise<void> {
    const invoiceIds = [
      ...(sums.value?.computedTopUps ?? []).map((t) => t.bexioInvoiceId),
      ...hostingInvoices.value.map((i) => i.bexioInvoiceId)
    ].filter((id): id is number => typeof id === 'number' && id > 0)
    const orderIds = hostingInvoices.value
      .map((i) => i.bexioOrderId)
      .filter((id): id is number => typeof id === 'number' && id > 0)
    if (invoiceIds.length === 0 && orderIds.length === 0) return
    const { statuses: s, orderLinks: o } = await statusComp.fetchBexioLinks(
      invoiceIds,
      orderIds
    )
    statuses.value = s
    orderLinks.value = o
  }

  function statusChip(invoiceId: number | null | undefined) {
    const status = invoiceId ? statuses.value[invoiceId] : undefined
    const badge = statusComp.statusBadge(status?.key)
    return { color: badge.color, label: t(badge.labelKey), known: !!status }
  }

  // Due date ("zahlbar bis") from the live Bexio invoice; falls back to the
  // given creation date until the status (which carries the due date) loads or
  // when no invoice is linked.
  function dueDate(
    invoiceId: number | null | undefined,
    fallbackFormatted: string
  ): string {
    const due = invoiceId ? statuses.value[invoiceId]?.dueDate : undefined
    return due ? formatDate(due) : fallbackFormatted
  }

  // Admins get the office.bexio.com link (full access, needs a Bexio login);
  // clients get the public, login-free `network_link` (null while draft).
  function invoiceHref(
    invoiceId: number | null | undefined
  ): string | undefined {
    if (!invoiceId) return undefined
    if (isAdmin.value) return topUpsComp.getBexioInvoiceUrl(invoiceId)
    return statuses.value[invoiceId]?.networkLink ?? undefined
  }

  function orderHref(orderId: number | null | undefined): string | undefined {
    if (!orderId) return undefined
    if (isAdmin.value) return topUpsComp.getBexioOrderUrl(orderId)
    return orderLinks.value[orderId] ?? undefined
  }

  // When no direct link applies (client, no public network_link), open the
  // document PDF proxied through the backend — the reliable login-free view.
  const pdfOpening = ref(false)

  async function onOpenInvoicePdf(invoiceId: number): Promise<void> {
    pdfOpening.value = true
    try {
      await statusComp.openInvoicePdf(invoiceId)
    } catch (err) {
      toast.add({
        color: 'error',
        title: t('billing.topUps.pdfError'),
        description: err instanceof Error ? err.message : undefined
      })
    } finally {
      pdfOpening.value = false
    }
  }

  async function onOpenOrderPdf(orderId: number): Promise<void> {
    pdfOpening.value = true
    try {
      await statusComp.openOrderPdf(orderId)
    } catch (err) {
      toast.add({
        color: 'error',
        title: t('billing.topUps.pdfError'),
        description: err instanceof Error ? err.message : undefined
      })
    } finally {
      pdfOpening.value = false
    }
  }

  const hostingColumns = computed(() => [
    { accessorKey: 'Datum', header: t('billing.topUps.hosting.table.date') },
    { accessorKey: 'Titel', header: t('billing.topUps.hosting.table.title') },
    { accessorKey: 'Monate', header: t('billing.topUps.hosting.table.months') },
    {
      accessorKey: 'Preis',
      header: t('billing.topUps.hosting.table.unitPrice')
    },
    { accessorKey: 'Total', header: t('billing.topUps.hosting.table.total') },
    {
      accessorKey: 'Invoice',
      header: t('billing.topUps.hosting.table.invoice')
    },
    { accessorKey: 'Order', header: t('billing.topUps.hosting.table.order') },
    { accessorKey: 'Status', header: t('billing.topUps.hosting.table.status') }
  ])

  const hostingForTable = computed(() =>
    hostingInvoices.value.map((invoice) => ({
      Datum: formatDate(invoice.date_created as string),
      Titel:
        invoice.title || invoice.description || t('billing.topUps.emptyNote'),
      Monate: t('billing.topUps.hosting.billedMonths', {
        billed: formatNumber(invoice.billedUnits),
        total: formatNumber(invoice.quantity)
      }),
      Preis: `CHF ${formatNumber(invoice.unitPrice, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`,
      Total: `CHF ${formatNumber(invoice.amount, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`,
      Invoice: invoice.bexioInvoiceId,
      Order: invoice.bexioOrderId
    }))
  )

  onMounted(async () => {
    await loadHostingInvoices()
    await refreshStatuses()
  })

  async function onChangeBillingMode(value: BillingMode): Promise<void> {
    const client = resolved.value?.client
    if (!client) return
    billingModePending.value = true
    try {
      await setBillingMode(client.id, value)
      client.billing_mode = value
      toast.add({
        title: t('billing.billingMode.updateSuccessTitle', {
          name: client.name
        }),
        description: billingModeLabel(value),
        color: 'success'
      })
    } catch (err) {
      toast.add({
        title: t('billing.billingMode.updateErrorTitle'),
        description: err instanceof Error ? err.message : undefined,
        color: 'error'
      })
    } finally {
      billingModePending.value = false
    }
  }
</script>

<template>
  <div>
    <UButton
      :to="dashboardLink"
      icon="lucide:chevron-left"
      variant="ghost"
      size="sm"
      class="mb-4"
    >
      {{ t('billing.backToDashboard') }}
    </UButton>

    <UPageCard>
      <template #default>
        <div class="flex justify-between items-start w-full">
          <div>
            <div class="font-bold text-xl">
              {{ resolved?.client?.name || t('billing.fallbackProjectName') }} ·
              {{ t('billing.topUps.titleSuffix') }}
            </div>
            <div v-if="formattedPeriod" class="text-xs text-muted mt-0.5">
              {{ formattedPeriod }}
            </div>
          </div>
          <div class="font-bold text-4xl text-primary whitespace-nowrap">
            {{ formatHours(sums?.totalTopUps ?? 0) }}
          </div>
        </div>

        <USkeleton v-if="pending" class="h-32 mt-6" />

        <UAlert
          v-else-if="error"
          class="mt-6"
          color="error"
          variant="soft"
          icon="i-heroicons-exclamation-triangle"
          :title="t('billing.loadError')"
          :description="error.message"
        />

        <div
          v-if="resolved?.client"
          class="mt-6 flex flex-wrap items-center gap-3"
        >
          <span class="text-sm font-medium">
            {{ t('billing.billingMode.label') }}
          </span>
          <USelectMenu
            v-if="userStore.amIAdministrator()"
            :model-value="resolved.client.billing_mode ?? 'prepaid'"
            :items="billingModeOptions"
            value-key="value"
            label-key="label"
            :loading="billingModePending"
            class="min-w-60"
            @update:model-value="
              (value: BillingMode) => onChangeBillingMode(value)
            "
          />
          <UBadge
            v-else
            :color="
              (resolved.client.billing_mode ?? 'prepaid') === 'monthly'
                ? 'warning'
                : 'primary'
            "
            variant="subtle"
          >
            {{ billingModeLabel(resolved.client.billing_mode) }}
          </UBadge>
          <span class="text-xs text-muted">
            {{
              (resolved.client.billing_mode ?? 'prepaid') === 'monthly'
                ? t('billing.billingMode.monthlyDescriptionShort')
                : t('billing.billingMode.prepaidDescriptionShort')
            }}
          </span>
        </div>

        <div v-if="!pending && !error" class="mt-6">
          <UTable :data="topUpsForTable" :columns="topUpsColumns">
            <template #Datum-cell="{ row }">
              {{ dueDate(row.original.Bexio, row.original.Datum) }}
            </template>
            <template #Bexio-cell="{ row }">
              <UButton
                v-if="invoiceHref(row.original.Bexio)"
                :href="invoiceHref(row.original.Bexio)"
                target="_blank"
                trailing-icon="lucide:external-link"
                variant="link"
              >
                {{
                  t('billing.topUps.invoiceNumber', {
                    number: row.original.Bexio
                  })
                }}
              </UButton>
              <UButton
                v-else-if="row.original.Bexio"
                :loading="pdfOpening"
                trailing-icon="lucide:file-text"
                variant="link"
                @click="onOpenInvoicePdf(row.original.Bexio)"
              >
                {{
                  t('billing.topUps.invoiceNumber', {
                    number: row.original.Bexio
                  })
                }}
              </UButton>
            </template>
            <template #Status-cell="{ row }">
              <UBadge
                v-if="
                  row.original.Bexio && statusChip(row.original.Bexio).known
                "
                :color="statusChip(row.original.Bexio).color"
                variant="subtle"
              >
                {{ statusChip(row.original.Bexio).label }}
              </UBadge>
            </template>
          </UTable>

          <div
            v-if="userStore.amIAdministrator() && clientPeriodId"
            class="flex justify-center w-full pt-6"
          >
            <UButton
              :to="`/${clientPeriodId}/create-bexio-invoice?amount=0`"
              variant="outline"
              icon="lucide:file-plus"
            >
              {{ t('billing.generateBexioInvoice') }}
            </UButton>
          </div>
        </div>
      </template>
    </UPageCard>

    <!-- Hosting / recurring invoices — separate tile, NOT counted toward hours -->
    <UPageCard v-if="hostingInvoices.length" class="mt-6">
      <template #default>
        <div class="font-bold text-xl">
          {{ t('billing.topUps.hosting.tileTitle') }}
        </div>
        <div class="text-xs text-muted mt-0.5">
          {{ t('billing.topUps.hosting.subtitle') }}
        </div>

        <div class="mt-6">
          <UTable :data="hostingForTable" :columns="hostingColumns">
            <template #Datum-cell="{ row }">
              {{ dueDate(row.original.Invoice, row.original.Datum) }}
            </template>
            <template #Invoice-cell="{ row }">
              <UButton
                v-if="invoiceHref(row.original.Invoice)"
                :href="invoiceHref(row.original.Invoice)"
                target="_blank"
                trailing-icon="lucide:external-link"
                variant="link"
              >
                {{
                  t('billing.topUps.invoiceNumber', {
                    number: row.original.Invoice
                  })
                }}
              </UButton>
              <UButton
                v-else-if="row.original.Invoice"
                :loading="pdfOpening"
                trailing-icon="lucide:file-text"
                variant="link"
                @click="onOpenInvoicePdf(row.original.Invoice)"
              >
                {{
                  t('billing.topUps.invoiceNumber', {
                    number: row.original.Invoice
                  })
                }}
              </UButton>
            </template>
            <template #Order-cell="{ row }">
              <UButton
                v-if="orderHref(row.original.Order)"
                :href="orderHref(row.original.Order)"
                target="_blank"
                trailing-icon="lucide:external-link"
                variant="link"
              >
                {{
                  t('billing.topUps.invoiceNumber', {
                    number: row.original.Order
                  })
                }}
              </UButton>
              <UButton
                v-else-if="row.original.Order"
                :loading="pdfOpening"
                trailing-icon="lucide:file-text"
                variant="link"
                @click="onOpenOrderPdf(row.original.Order)"
              >
                {{
                  t('billing.topUps.invoiceNumber', {
                    number: row.original.Order
                  })
                }}
              </UButton>
            </template>
            <template #Status-cell="{ row }">
              <UBadge
                v-if="
                  row.original.Invoice && statusChip(row.original.Invoice).known
                "
                :color="statusChip(row.original.Invoice).color"
                variant="subtle"
              >
                {{ statusChip(row.original.Invoice).label }}
              </UBadge>
            </template>
          </UTable>
        </div>
      </template>
    </UPageCard>
  </div>
</template>
