import { BEXIO_API_BASE_URL } from './constants'

/**
 * Minimal HTTP surface for the Bexio endpoints the `bexio` npm SDK does NOT
 * cover: recurring orders, order repetition, "create invoice from order", and
 * a plain invoice GET for status. Mirrors the SDK's own `BaseCrud.request`
 * (same base URL + Bearer auth) so behaviour is consistent with the parts of
 * the integration that go through the SDK.
 *
 * Uses the Node 22 global `fetch` to avoid pulling axios into the bundle.
 */
export async function bexioRequest<T>(
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: unknown
): Promise<T> {
  const response = await fetch(`${BEXIO_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: data === undefined ? undefined : JSON.stringify(data)
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Bexio request failed: ${method} ${path} -> ${response.status} ${body}`
    )
  }

  return (await response.json()) as T
}
