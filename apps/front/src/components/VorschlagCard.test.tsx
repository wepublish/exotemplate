import { render, screen, fireEvent } from '@testing-library/react'
import { VorschlagCard } from './VorschlagCard'
import type { Vorschlag } from '@/graphql/vorschlaege'

const v: Vorschlag = {
  id: 'abc',
  ts: '2026-06-04T08:00:00',
  typ: 'match',
  medium_id: 'bajour',
  stiftung_id: '12001',
  stiftung_name: 'Fondation Beispiel',
  titel: 'Neuer starker Match für bajour',
  beschreibung: 'Score 78, passt zu Lokaljournalismus.',
  prioritaet: 'hoch',
  frist: null,
  artefakt_link: null,
  begruendung: 'Tag- und Embedding-Übereinstimmung hoch.',
  status: 'offen',
  quelle_modell: 'sonnet-4.6',
}

test('zeigt Titel, Stiftung und Typ-Label', () => {
  render(<VorschlagCard vorschlag={v} onEntscheiden={() => {}} onAnpassen={() => {}} />)
  expect(screen.getByText('Neuer starker Match für bajour')).toBeInTheDocument()
  expect(screen.getByText('Fondation Beispiel')).toBeInTheDocument()
  expect(screen.getByText('Match')).toBeInTheDocument()
})

test('Freigeben und Verneinen rufen onEntscheiden mit korrektem Status', () => {
  const onEntscheiden = jest.fn()
  render(<VorschlagCard vorschlag={v} onEntscheiden={onEntscheiden} onAnpassen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Freigeben/i }))
  expect(onEntscheiden).toHaveBeenCalledWith(v, 'freigegeben')
  fireEvent.click(screen.getByRole('button', { name: /Verneinen/i }))
  expect(onEntscheiden).toHaveBeenCalledWith(v, 'verneint')
})
