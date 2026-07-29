'use client'

import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { NoteFields } from '@/graphql/notes'
import { formatDateTime, parseStoredSummary, statusLabel } from '@/lib/notes'

export interface NoteCardProps {
  note: NoteFields
  busy: boolean
  onSummarize: (id: string) => void
  onDelete: (id: string) => void
}

// A presentational component: props in, callbacks out, no data fetching. Keeping
// components dumb is what makes them testable — see NoteCard.test.tsx.
export function NoteCard({ note, busy, onSummarize, onDelete }: NoteCardProps) {
  const summary = parseStoredSummary(note.ai_summary)

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h2" component="h3" sx={{ wordBreak: 'break-word' }}>
            {note.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {statusLabel(note.status)} · {formatDateTime(note.date_created)}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={busy ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
            disabled={busy}
            onClick={() => onSummarize(note.id)}
          >
            {summary === null ? 'Zusammenfassen' : 'Neu zusammenfassen'}
          </Button>
          <Button
            size="small"
            color="error"
            aria-label={`Notiz ${note.title} loeschen`}
            disabled={busy}
            onClick={() => onDelete(note.id)}
          >
            <DeleteOutlinedIcon fontSize="small" />
          </Button>
        </Stack>
      </Stack>

      {note.body !== null && note.body.trim() !== '' && (
        <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>
          {note.body}
        </Typography>
      )}

      {summary !== null && (
        <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
          <Typography variant="overline" color="text.secondary">
            Zusammenfassung durch Claude
          </Typography>
          <Typography variant="body2">{summary.text}</Typography>
          {summary.tags.length > 0 && (
            <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
              {summary.tags.map((tag) => (
                <Chip key={tag} label={tag} size="small" />
              ))}
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Erzeugt: {formatDateTime(note.ai_summary_generated_at)}
          </Typography>
        </Box>
      )}
    </Paper>
  )
}
