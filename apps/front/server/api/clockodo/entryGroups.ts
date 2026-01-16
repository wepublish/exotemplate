import axios from 'axios'
import {format} from 'date-fns'

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

  const {customer_id: customerId, from, to} = getQuery(event)

  if (!customerId || !from || !to) {
    throw new Error('customerId or fromParam or toParam not provided!')
  }

  const fromFormated = format(new Date(from as string), 'yyyy-MM-dd') + 'T00:00:00Z'
  const toFormated = format(new Date(to as string), 'yyyy-MM-dd') + 'T00:00:00Z'

  const params = {
    time_since: fromFormated,
    time_until: toFormated,
    grouping: ['services_id', 'texts_id', 'day'],
    round_to_minutes: 15,
    filter: {
      customers_id: customerId,
      billable: 2
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