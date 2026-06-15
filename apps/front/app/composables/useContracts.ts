import { readItems } from '@directus/sdk'
import axios from 'axios'
import type { Contract } from '~~/types/DirectusTypes'

const CONTRACT_FIELDS = [
  'id',
  'status',
  'version',
  'client',
  'file',
  'signed',
  'signed_at',
  'notes',
  'date_created',
  'date_updated'
] as const

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result)
      // strip the `data:application/pdf;base64,` prefix
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Contract access: list via the SDK (Client-policy read scoped by ownership),
 * upload a (new version of the) signed PDF via the custom `POST /contracts`
 * route, and download the stored file via Directus' native `/assets/:id`
 * (fetched as an authenticated blob — a plain <a> can't send the bearer token;
 * the Client policy grants read on directus_files in the "contracts" folder).
 */
export function useContracts() {
  const { directus, API_URL } = useDirectus()

  async function listForClient(clientId: string): Promise<Contract[]> {
    return (await directus.request(
      readItems('Contracts', {
        filter: { client: { _eq: clientId } },
        sort: ['-version'],
        fields: [...CONTRACT_FIELDS],
        limit: -1
      })
    )) as Contract[]
  }

  /**
   * Upload a contract PDF for a client, creating the next version. `signed`
   * defaults to true (the common case is uploading the already-signed contract).
   */
  async function uploadContract(
    clientId: string,
    file: File,
    options: { signed?: boolean; notes?: string } = {}
  ): Promise<Contract> {
    const fileBase64 = await fileToBase64(file)
    const token = await directus.getToken()
    const res = await axios.post(
      `${API_URL()}/contracts`,
      {
        clientId,
        fileBase64,
        fileName: file.name,
        signed: options.signed !== false,
        notes: options.notes
      },
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    )
    return res.data.data as Contract
  }

  // Fetches a stored contract file as an authenticated blob and returns an
  // object URL (caller revokes it).
  async function fileObjectUrl(fileId: string): Promise<string> {
    const token = await directus.getToken()
    const res = await axios.get(`${API_URL()}/assets/${fileId}`, {
      responseType: 'blob',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    return URL.createObjectURL(res.data as Blob)
  }

  async function downloadFile(fileId: string, fileName: string): Promise<void> {
    const url = await fileObjectUrl(fileId)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return {
    listForClient,
    uploadContract,
    fileObjectUrl,
    downloadFile
  }
}
