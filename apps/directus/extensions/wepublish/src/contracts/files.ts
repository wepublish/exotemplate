import { Readable } from 'node:stream'

// Directus service glue for contract files. The upload runs with system
// accountability so a client can submit their signed PDF without being granted
// file-create permission. Downloading the file is NOT handled here — it goes
// through Directus' native `/assets/:id` endpoint, gated by the Client policy's
// `directus_files` read permission (folder = "contracts").
export interface FilesDeps {
  services: any
  getSchema: () => Promise<any>
  env: Record<string, unknown>
}

export const PDF_MIME = 'application/pdf'

const CONTRACTS_FOLDER_NAME = 'contracts'

function defaultStorage(env: Record<string, unknown>): string {
  const locations = env.STORAGE_LOCATIONS
  if (typeof locations === 'string' && locations.trim().length > 0) {
    return locations.split(',')[0]!.trim()
  }
  return 'local'
}

// Resolves the dedicated top-level `contracts` folder id, creating it if missing.
export async function ensureContractsFolder(deps: FilesDeps): Promise<string> {
  const schema = await deps.getSchema()
  const folders = new deps.services.ItemsService('directus_folders', { schema })
  const existing = await folders.readByQuery({
    filter: { name: { _eq: CONTRACTS_FOLDER_NAME }, parent: { _null: true } },
    limit: 1
  })
  if (existing[0]?.id) return existing[0].id as string
  return (await folders.createOne({ name: CONTRACTS_FOLDER_NAME })) as string
}

// Streams a PDF buffer into the `contracts` folder; returns the new file id.
export async function uploadContractPdf(
  deps: FilesDeps,
  accountability: unknown,
  params: { buffer: Buffer; fileName: string; folderId: string }
): Promise<string> {
  const schema = await deps.getSchema()
  const filesService = new deps.services.FilesService({
    schema,
    accountability
  })
  const stream = Readable.from(params.buffer)
  const title = params.fileName.replace(/\.pdf$/i, '')
  const primaryKey = await filesService.uploadOne(stream, {
    storage: defaultStorage(deps.env),
    filename_download: params.fileName,
    title,
    type: PDF_MIME,
    folder: params.folderId
  })
  return primaryKey as string
}
