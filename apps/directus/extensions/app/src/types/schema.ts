// Typed view of the collections this application owns.
//
// Keep it in sync with the data model by hand, or regenerate it: the bundled
// `directus-extension-ts-typegen` module (Settings → TypeScript Types in the
// admin UI) writes these types from the live schema. Paste the result here and
// keep the hand-written notes.
//
// The frontend does NOT import this file — it is a separate npm package. It
// generates its own types from the GraphQL schema (`npm run codegen` in
// apps/front). One data model, two generated views of it.

export type NoteStatus = 'draft' | 'published' | 'archived'

export interface Note {
  id: string
  status: NoteStatus
  title: string
  body: string | null
  /** Written only by the notes-summary endpoint and the notes-digest operation. */
  ai_summary: string | null
  ai_summary_generated_at: string | null
  date_created: string | null
  date_updated: string | null
}

export interface Schema {
  notes: Note[]
}
