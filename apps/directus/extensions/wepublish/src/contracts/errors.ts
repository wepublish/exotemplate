import { createError } from '@directus/errors'

export const INVALID_PDF_ERROR = createError(
  'INVALID_CONTRACT_PDF',
  'The uploaded contract must be a non-empty PDF file.',
  422
)
