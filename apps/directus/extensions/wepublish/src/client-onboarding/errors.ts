import { createError } from '@directus/errors'

export const MISSING_ENV_ERROR = createError('500', 'Missing env variables.')

export const BEXIO_CONTACT_ERROR = createError(
  '500',
  'Bexio contact creation failed: no ID returned.',
  500
)

export const WORKFLOW_SCHEME_NOT_FOUND_ERROR = createError(
  'NOT_FOUND',
  'Workflow scheme not found.',
  404
)

export const BOARD_NOT_FOUND_ERROR = createError(
  'NOT_FOUND',
  'No Scrum board found for the newly created project.',
  404
)

export const CLOCKODO_CUSTOMER_NOT_FOUND_ERROR = createError(
  'NOT_FOUND',
  'No matching Clockodo customer found. Ensure the Bexio integration has synced and the name matches exactly.',
  404
)
