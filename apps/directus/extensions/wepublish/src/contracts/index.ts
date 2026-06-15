import { defineEndpoint } from '@directus/extensions-sdk'
import { ForbiddenError, InvalidPayloadError } from '@directus/errors'
import type { Client, Contract } from '../DirectusTypes'
import {
  ensureContractsFolder,
  uploadContractPdf,
  type FilesDeps
} from './files'
import { buildContractFileName, nextContractVersion } from './helpers'
import { INVALID_PDF_ERROR } from './errors'

// Contracts are simple uploaded PDFs, versioned per client. The only custom
// route is the upload: it runs the file write + row create with system
// accountability so a client can submit their signed contract without being
// granted file-create / item-create permissions. Listing and downloading use
// Directus' native SDK + `/assets/:id`, gated by the Client policy's read
// permissions (Contracts + directus_files folder = "contracts").
export default defineEndpoint((router, context) => {
  const deps: FilesDeps = {
    services: context.services,
    getSchema: context.getSchema,
    env: context.env
  }

  /**
   * POST / — upload a (new version of a) contract PDF for a client.
   * Body: { clientId, fileBase64, fileName?, signed?, notes? }.
   * Admins may upload for any client; a client user may upload for a client
   * they belong to (also lets an admin record a client's signed copy). Each
   * upload creates the next version, which becomes the one "in effect".
   */
  router.post('/', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())

      const { clientId, fileBase64, fileName, signed, notes } = (req.body ??
        {}) as Record<string, unknown>
      if (typeof clientId !== 'string' || typeof fileBase64 !== 'string') {
        return next(
          new InvalidPayloadError({ reason: 'Required: clientId, fileBase64.' })
        )
      }

      const buffer = Buffer.from(fileBase64, 'base64')
      if (buffer.length === 0 || buffer.subarray(0, 5).toString() !== '%PDF-') {
        return next(new INVALID_PDF_ERROR())
      }

      const schema = await context.getSchema()

      // Access check under the caller's accountability — readOne throws
      // Forbidden/404 if the user can't see this client (Client policy scopes
      // by `allowedUsers`). Admins pass via admin_access.
      const scopedClients = new context.services.ItemsService('Clients', {
        schema,
        accountability
      })
      const client = (await scopedClients.readOne(clientId, {
        fields: ['id', 'name']
      })) as Pick<Client, 'id' | 'name'>

      // Privileged services for the actual writes (no accountability = system),
      // so client users don't need file-create / Contracts-create permissions.
      const contractsService = new context.services.ItemsService('Contracts', {
        schema
      })
      const existing = (await contractsService.readByQuery({
        filter: { client: { _eq: clientId } },
        fields: ['version'],
        limit: -1
      })) as Pick<Contract, 'version'>[]
      const version = nextContractVersion(existing)
      const isSigned = signed !== false // default: an uploaded contract is signed

      const folderId = await ensureContractsFolder(deps)
      const uploadName =
        typeof fileName === 'string' && fileName.trim()
          ? fileName
          : buildContractFileName(client.name ?? 'Vertrag', version)
      const fileId = await uploadContractPdf(deps, null, {
        buffer,
        fileName: uploadName,
        folderId
      })

      const id = await contractsService.createOne({
        client: clientId,
        version,
        file: fileId,
        signed: isSigned,
        signed_at: isSigned ? new Date().toISOString() : null,
        status: 'published',
        notes: typeof notes === 'string' ? notes : null
      })

      const created = await contractsService.readOne(id, {
        fields: [
          'id',
          'status',
          'version',
          'client',
          'file',
          'signed',
          'signed_at',
          'notes',
          'date_created'
        ]
      })
      return res.json({ data: created })
    } catch (e) {
      return next(e)
    }
  })
})
