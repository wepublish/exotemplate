import { ForbiddenError, InvalidPayloadError } from '@directus/errors'
import { MISSING_ENV_ERROR } from './errors'

export type NextFn = (err?: unknown) => void

// Returns true when the caller is an authenticated Directus admin; otherwise
// forwards a ForbiddenError and returns false.
export function requireAdmin(req: any, next: NextFn): boolean {
  if (!req.accountability?.admin) {
    next(new ForbiddenError())
    return false
  }
  return true
}

// Validates that all requested env variables are present. Returns them as a
// map on success, or forwards MISSING_ENV_ERROR and returns null.
export function requireEnv<K extends string>(
  env: Record<string, any>,
  keys: readonly K[],
  next: NextFn
): Record<K, string> | null {
  const out = {} as Record<K, string>
  for (const key of keys) {
    const value = env[key]
    if (!value || typeof value !== 'string') {
      next(new MISSING_ENV_ERROR())
      return null
    }
    out[key] = value
  }
  return out
}

// Validates that all listed keys exist on the request body.
export function requireBodyParams<K extends string>(
  body: Record<string, any> | undefined,
  keys: readonly K[],
  next: NextFn
): Record<K, any> | null {
  if (!body) {
    next(
      new InvalidPayloadError({
        reason: `Missing required body params: ${keys.join(', ')}`
      })
    )
    return null
  }
  const missing = keys.filter((k) => !body[k])
  if (missing.length > 0) {
    next(
      new InvalidPayloadError({
        reason: `Missing required body params: ${missing.join(', ')}`
      })
    )
    return null
  }
  return keys.reduce(
    (acc, key) => {
      acc[key] = body[key]
      return acc
    },
    {} as Record<K, any>
  )
}

// Wraps an async handler so thrown errors are forwarded to Express' next().
// An optional `onError` hook lets controllers translate errors (e.g. axios
// errors into proxied HTTP responses).
export function asyncHandler(
  handler: (req: any, res: any, next: NextFn) => Promise<unknown>,
  onError?: (err: any, req: any, res: any, next: NextFn) => unknown
) {
  return async (req: any, res: any, next: NextFn): Promise<unknown> => {
    try {
      return await handler(req, res, next)
    } catch (error) {
      if (onError) return onError(error, req, res, next)
      return next(error)
    }
  }
}

// Forwards an upstream axios error as the HTTP response, preserving the
// original status code and body. Falls back to next() for non-axios errors.
export function forwardAxiosError(
  error: any,
  _req: any,
  res: any,
  next: NextFn
) {
  if (error?.response) {
    return res.status(error.response.status).json(error.response.data)
  }
  return next(error)
}
