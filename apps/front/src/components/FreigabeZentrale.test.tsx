import { render, screen, fireEvent } from '@testing-library/react'
import { FreigabeListe } from './FreigabeZentrale'
import type { OutboxEintrag } from '@/lib/outbox'

const slack: OutboxEintrag = {
  id: 'e1',
  ts: '2026-06-11T08:00:00',
  typ: 'slack',
  anlass: 'matching_liste',
  status: 'entwurf',
  medium_id: 'neue_wege',
  application_id: null,
  stiftung_id: null,
  empfaenger: '#faas-admin',
  betreff: null,
  inhalt: 'Hier ist deine Matching-Liste für neue_wege.',
  anhang: null,
  erstellt_von: null,
  fehler_text: null,
}

const gesuch: OutboxEintrag = {
  id: 'e2',
  ts: '2026-06-11T09:00:00',
  typ: 'gesuch_final',
  anlass: 'gesuch',
  status: 'entwurf',
  medium_id: 'bajour',
  application_id: '42',
  stiftung_id: 1001,
  empfaenger: 'foerderung@beispielstiftung.ch',
  betreff: 'Gesuch um Förderung',
  inhalt: 'Sehr geehrte Damen und Herren, wir bewerben uns ...',
  anhang: null,
  erstellt_von: null,
  fehler_text: null,
}

test('zeigt Anlass-Label für beide Einträge', () => {
  render(
    <FreigabeListe
      eintraege={[slack, gesuch]}
      sendetId={null}
      onSenden={() => {}}
      onVerwerfen={() => {}}
      onAnsehen={() => {}}
    />
  )
  // Anlass-Label (aus ANLASS_LABEL)
  expect(screen.getByText('Matching-Liste')).toBeInTheDocument()
  // Anlass-Label für gesuch — exakter Text-Match auf den Anlass-Badge
  expect(screen.getAllByText('Gesuch').length).toBeGreaterThanOrEqual(1)
})

test('Senden-Button beim slack-Eintrag vorhanden, beim gesuch_final nicht (kein kannSenden)', () => {
  render(
    <FreigabeListe
      eintraege={[slack, gesuch]}
      sendetId={null}
      onSenden={() => {}}
      onVerwerfen={() => {}}
      onAnsehen={() => {}}
    />
  )
  // Es gibt genau einen Senden-Button (nur für den slack-Eintrag)
  const sendenButtons = screen.getAllByRole('button', { name: /Senden/i })
  expect(sendenButtons).toHaveLength(1)
})

test('Klick auf Senden ruft onSenden mit dem richtigen Eintrag', () => {
  const onSenden = jest.fn()
  render(
    <FreigabeListe
      eintraege={[slack, gesuch]}
      sendetId={null}
      onSenden={onSenden}
      onVerwerfen={() => {}}
      onAnsehen={() => {}}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: /^Senden$/i }))
  expect(onSenden).toHaveBeenCalledWith(slack)
})

test('Klick auf Verwerfen ruft onVerwerfen mit dem richtigen Eintrag', () => {
  const onVerwerfen = jest.fn()
  render(
    <FreigabeListe
      eintraege={[slack]}
      sendetId={null}
      onSenden={() => {}}
      onVerwerfen={onVerwerfen}
      onAnsehen={() => {}}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: /Verwerfen/i }))
  expect(onVerwerfen).toHaveBeenCalledWith(slack)
})

test('zeigt Leerzustand-Text bei leerer Liste', () => {
  render(
    <FreigabeListe
      eintraege={[]}
      sendetId={null}
      onSenden={() => {}}
      onVerwerfen={() => {}}
      onAnsehen={() => {}}
    />
  )
  expect(screen.getByText(/Nichts versandbereit/)).toBeInTheDocument()
})
