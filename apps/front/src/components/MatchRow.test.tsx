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

// ─── Regression: langer Freitext-Betrag darf die Karte nicht sprengen ──────────
// Befund 2026-07-27: `betrag` kommt aus foerdersummen_range bzw. foerderbeitraege
// und ist Freitext von "CHF 5'000" bis zu ganzen Absaetzen (Kanton Bern:
// 224 Zeichen). Der Block war flex-shrink-0 und ohne Breitengrenze: er nahm die
// ganze Zeile, quetschte den Stiftungsnamen auf null und lief aus der Karte.
const LANGER_BETRAG =
  'Nachrichtenagenturen: Leistungsvertraege mit Betriebsbeitraegen bis hoechstens ' +
  "100'000 Franken pro Jahr. Projektfoerderung: befristete Beitraege bis 20'000 " +
  'Franken pro Jahr und Vorhaben; angemessene Eigenleistungen vorausgesetzt.'

function renderMitBetrag(betrag: string) {
  const r = { ...row, betrag }
  return render(
    <Accordion type="multiple" defaultValue={[r.id]}>
      <MatchRow row={r} rank={1} medium="wepublish" />
    </Accordion>
  )
}

test('langer Betrag: Badge ist gedeckelt und gekuerzt, nicht unbegrenzt breit', () => {
  const { container } = renderMitBetrag(LANGER_BETRAG)
  const badge = container.querySelector(`[title="${LANGER_BETRAG}"]`)
  expect(badge).not.toBeNull()
  const klassen = badge!.className
  expect(klassen).toMatch(/max-w-/)
  expect(klassen).toMatch(/overflow-hidden/)
  expect(badge!.querySelector('.truncate')).not.toBeNull()
})

test('langer Betrag: umgebender Block darf schrumpfen (kein flex-shrink-0)', () => {
  const { container } = renderMitBetrag(LANGER_BETRAG)
  const badge = container.querySelector(`[title="${LANGER_BETRAG}"]`)
  const block = badge!.parentElement!
  expect(block.className).not.toMatch(/shrink-0/)
  expect(block.className).toMatch(/min-w-0/)
})

test('langer Betrag: Volltext steht im aufgeklappten Detail', () => {
  renderMitBetrag(LANGER_BETRAG)
  expect(screen.getByText('Belegte Fördersummen')).toBeInTheDocument()
  const volltext = screen.getAllByText(LANGER_BETRAG)
  // Einmal gekuerzt im Badge, einmal vollstaendig im Detail.
  expect(volltext.length).toBeGreaterThanOrEqual(2)
})

test('Stiftungsname bleibt trotz langem Betrag im DOM', () => {
  renderMitBetrag(LANGER_BETRAG)
  expect(screen.getByText('Medien-Stiftung')).toBeInTheDocument()
})
