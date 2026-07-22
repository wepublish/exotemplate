import { render, screen, fireEvent } from '@testing-library/react'
import { SichtungsKarte } from './SichtungsStapel'
import type { Paket } from '@/lib/pakete'

const paketVoll: Paket = {
  score: 78,
  begruendung_kurz: 'Starker thematischer Match, regionale Förderpraxis passt.',
  betrag: { suggested_amount: 25000, reasoning: 'Vergleichbare Projekte 20-30k' },
  gold: false,
  gesuch_prompt: 'Sehr geehrte Damen und Herren...',
  gesuch_ablage: '/drive/wepublish/stiftung_greulich',
  einreichungs_check: { formular_erfasst: true, hinweis: 'Online-Formular' },
  outbox_ids: ['o1', 'o2'],
  gebaut_am: '2026-06-11T02:30:00',
}

const paketGold: Paket = {
  ...paketVoll,
  gold: true,
  betrag: null,
  outbox_ids: [],
  einreichungs_check: { formular_erfasst: false, hinweis: '' },
}

function karte(overrides?: object) {
  return (
    <SichtungsKarte
      app={{
        id: 'app-1',
        medium_id: 'bajour',
        stiftung_id: 12001,
        stiftung_name: 'Fondation Greulich',
        status: 'identifiziert',
        gesichtet_am: null,
        paket: paketVoll,
      }}
      paket={paketVoll}
      position={1}
      total={5}
      beschaeftigt={false}
      onUebernehmen={jest.fn()}
      onSpaeter={jest.fn()}
      onVerwerfen={jest.fn()}
      {...overrides}
    />
  )
}

test('zeigt Stiftungsname, Medium und Positions-Zähler', () => {
  render(karte())
  expect(screen.getByText(/Fondation Greulich/)).toBeInTheDocument()
  expect(screen.getByText(/bajour/)).toBeInTheDocument()
  expect(screen.getByText(/1 von 5/)).toBeInTheDocument()
})

test('zeigt Score und CHF-Betrag-Badge', () => {
  render(karte())
  expect(screen.getByText(/Score 78/)).toBeInTheDocument()
  expect(screen.getByText(/CHF 25.000/)).toBeInTheDocument()
})

test('zeigt «kein Betrag» wenn betrag null', () => {
  render(karte({ paket: { ...paketVoll, betrag: null } }))
  expect(screen.getByText(/kein Betrag/)).toBeInTheDocument()
})

test('zeigt Gold-Badge nur wenn gold=true', () => {
  const { rerender } = render(karte({ paket: paketVoll }))
  expect(screen.queryByText('Gold')).toBeNull()

  rerender(karte({ paket: paketGold }))
  expect(screen.getByText('Gold')).toBeInTheDocument()
})

test('zeigt begruendung_kurz als Text', () => {
  render(karte())
  expect(screen.getByText(/Starker thematischer Match/)).toBeInTheDocument()
})

test('zeigt vier Check-Labels', () => {
  render(karte())
  expect(screen.getByText(/Betrag berechnet/)).toBeInTheDocument()
  expect(screen.getByText(/Gesuch-Prompt bereit/)).toBeInTheDocument()
  expect(screen.getByText(/Mitteilung vorbereitet/)).toBeInTheDocument()
  expect(screen.getByText(/Einreichung erfasst/)).toBeInTheDocument()
})

test('Gold-Prompt-Label erscheint wenn gold=true', () => {
  render(karte({ paket: paketGold }))
  expect(screen.getByText(/Gold-Prompt bereit/)).toBeInTheDocument()
})

test('Übernehmen-Button ruft onUebernehmen', () => {
  const onUebernehmen = jest.fn()
  render(karte({ onUebernehmen }))
  fireEvent.click(screen.getByRole('button', { name: /Übernehmen/i }))
  expect(onUebernehmen).toHaveBeenCalledTimes(1)
})

test('Später-Button ruft onSpaeter', () => {
  const onSpaeter = jest.fn()
  render(karte({ onSpaeter }))
  fireEvent.click(screen.getByRole('button', { name: /Später/i }))
  expect(onSpaeter).toHaveBeenCalledTimes(1)
})

test('Verwerfen-Button ruft onVerwerfen', () => {
  const onVerwerfen = jest.fn()
  render(karte({ onVerwerfen }))
  fireEvent.click(screen.getByRole('button', { name: /Verwerfen/i }))
  expect(onVerwerfen).toHaveBeenCalledTimes(1)
})

test('alle Buttons sind disabled wenn beschaeftigt=true', () => {
  render(karte({ beschaeftigt: true }))
  const buttons = screen.getAllByRole('button')
  buttons.forEach((btn) => expect(btn).toBeDisabled())
})
