import { createError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import type { NextFunction, Response } from 'express'
import { completeJson } from '../../shared/claude'
import { isAuthenticated, type ApiRequest } from '../../shared/http'
import type { Note } from '../../types/schema'
import {
  buildSummaryPrompt,
  formatSummaryForStorage,
  parseSummary,
  SUMMARY_SYSTEM_PROMPT
} from './prompt'

// POST /notes-summary/:id
//
// The template's example of a custom endpoint: authenticated, reads through a
// Directus service (so permissions and hooks apply), calls Claude, writes the
// result back. Copy this shape for your own endpoints.

const ForbiddenError = createError('FORBIDDEN', 'Anmeldung erforderlich.', 401)
const NoteNotFoundError = createError(
  'NOTE_NOT_FOUND',
  'Notiz nicht gefunden.',
  404
)
const SummaryFailedError = createError(
  'SUMMARY_FAILED',
  'Die Zusammenfassung konnte nicht erzeugt werden.',
  502
)

export default defineEndpoint((router, { services, getSchema, logger }) => {
  const { ItemsService } = services

  router.post(
    '/:id',
    async (req: ApiRequest, res: Response, next: NextFunction) => {
      if (!isAuthenticated(req)) return next(new ForbiddenError())

      const id = req.params['id']
      if (id === undefined || id === '') return next(new NoteNotFoundError())

      try {
        // Passing `accountability` makes the read obey the caller's permissions.
        // Omit it only where an endpoint must deliberately act as the system.
        const notes = new ItemsService('notes', {
          schema: await getSchema(),
          accountability: req.accountability
        })

        const note = (await notes.readOne(id, {
          fields: ['id', 'title', 'body']
        })) as Pick<Note, 'id' | 'title' | 'body'> | null

        if (note === null) return next(new NoteNotFoundError())

        const answer = await completeJson<unknown>({
          system: SUMMARY_SYSTEM_PROMPT,
          prompt: buildSummaryPrompt(note),
          maxTokens: 1024
        })

        const summary = parseSummary(answer)

        await notes.updateOne(id, {
          ai_summary: formatSummaryForStorage(summary),
          ai_summary_generated_at: new Date().toISOString()
        })

        return res.json({ data: { id, ...summary } })
      } catch (error) {
        // Log the cause, return a stable error to the client. Never leak a raw
        // provider error (it can contain the prompt) to the browser.
        logger.error(error, `notes-summary failed for note ${id}`)
        return next(new SummaryFailedError())
      }
    }
  )
})
