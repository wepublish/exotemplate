import axios from 'axios'

export interface EntryGroup {
  group: string[]
  grouped_by: string[]
  name: string
  revenue: number
  budget: number
  budget_is_hours: boolean
  budget_is_strict: boolean
  note: string
  hourly_rate: number
  billable: number
  billable_amount: number
  duration: number
  restrictions: string[]
  sub_groups: EntryGroup[]
}

export default defineEventHandler(async (event): Promise<{groups: EntryGroup[]}> => {
  const config = useRuntimeConfig()

  // Default parameters for getEntrygroupsV2
  // Documentation: https://docs.clockodo.com/#tag/EntryGroup/operation/getEntrygroupsV2
  const params = {
    time_since: '2025-01-01T00:00:00Z',
    time_until: '2025-12-31T00:00:00Z',
    grouping: ['customers_id', 'services_id', 'texts_id', 'day'], // Required: How to group the entries
    round_to_minutes: 15, // Optional: Rounding factor
    filter: {
      customers_id: 3294981
    }
  }

  try {
    const response = await axios.get('https://my.clockodo.com/api/v2/entrygroups', {
      params,
      headers: {
      'X-Clockodo-External-Application': 'Inside We.Publish Nuxt Application',
      'X-ClockodoApiUser': config.clockodoApiEmail,
      'X-ClockodoApiKey': config.clockodoApiKey,
      }
    })

    return response.data
  } catch (error: any) {
    const errorMessage = JSON.stringify(error.response?.data || error.message)
    console.error(errorMessage)
    throw createError({
      statusCode: error.response?.status || 500,
      statusMessage: errorMessage,
      data: error.response?.data
    })
  }
})