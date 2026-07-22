/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import { Accordion } from '@/components/ui/accordion'
import { MatchRow } from './MatchRow'

// Apollo-Hooks werden nicht wirklich ausgeloest — generischer Mock.
jest.mock('@apollo/client/react', () => ({
  useMutation: () => [jest.fn().mockResolvedValue({}), { loading: false }],
  useApolloClient: () => ({
    query: jest.fn().mockResolvedValue({ data: { agent_outbox: [] } }),
  }),
}))

const row = {
  id: '1',
  stiftungId: '9',
  name: 'Medien-Stiftung',
  score: 87,
  konfidenz: 'web',
  schaerfe: 80,
  betrag: '20-80k',
  tags: [{ tag_slug: 'pressefreiheit', gewicht: 3, begruendung: 'fördert Journalismus' }],
  soundFeeling: 'sf',
  begruendung: 'g',
  website: null,
  breakdown: {},
} as any

// Accordion voraufgeklappt rendern (value="1" entspricht row.id), damit
// AccordionContent und AktionsBereich im DOM sichtbar sind.
function renderRow(application?: any) {
  return render(
    <Accordion type="multiple" defaultValue={[row.id]}>
      <MatchRow row={row} rank={1} medium="wepublish" application={application} />
    </Accordion>
  )
}

test('zeigt name, score, grund inline, konfidenz', () => {
  render(
    <Accordion type="multiple">
      <MatchRow row={row} rank={1} />
    </Accordion>
  )
  expect(screen.getByText('Medien-Stiftung')).toBeInTheDocument()
  expect(screen.getByText('Score 87%')).toBeInTheDocument()
  expect(screen.getByText(/Web/)).toBeInTheDocument()
})

test('ohne Antrag: zeigt In-Antraege-Knopf, keinen Ausblenden-Funnel-Knopf', () => {
  renderRow(undefined)
  expect(screen.getByRole('button', { name: /In Antr/i })).toBeInTheDocument()
  // Kein nachtraeglicher Ausblenden-Knopf im Funnel-Badge-Bereich
  expect(screen.queryByText('Im Funnel:')).not.toBeInTheDocument()
})

test('Antrag identifiziert: zeigt Funnel-Badge und Ausblenden-Knopf', () => {
  renderRow({ id: 'app-1', stiftung_id: '9', status: 'identifiziert', bemerkung: null })
  expect(screen.getByText(/Im Funnel:/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Ausblenden/ })).toBeInTheDocument()
})

test('Antrag in_arbeit: zeigt Ausblenden-Knopf', () => {
  renderRow({ id: 'app-2', stiftung_id: '9', status: 'in_arbeit', bemerkung: null })
  expect(screen.getByRole('button', { name: /Ausblenden/ })).toBeInTheDocument()
})

test('Antrag eingereicht: kein Ausblenden-Knopf im Funnel-Badge-Bereich', () => {
  renderRow({ id: 'app-3', stiftung_id: '9', status: 'eingereicht', bemerkung: null })
  expect(screen.getByText(/Im Funnel:/)).toBeInTheDocument()
  // Kein Ausblenden-Knopf fuer weitergefuehrte Antraege
  expect(screen.queryByRole('button', { name: /^Ausblenden$/ })).not.toBeInTheDocument()
})

test('Antrag ausgeblendet: zeigt Wieder-Einblenden-Knopf, keinen Ausblenden-Knopf', () => {
  renderRow({
    id: 'app-4',
    stiftung_id: '9',
    status: 'ausgeblendet',
    bemerkung: 'Ausgeblendet: Medien-Stiftung. Grund: Passt inhaltlich nicht.',
  })
  expect(screen.getByRole('button', { name: /Wieder einblenden/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Ausblenden$/ })).not.toBeInTheDocument()
})
