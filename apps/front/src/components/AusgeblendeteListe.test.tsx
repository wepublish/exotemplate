/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react'
import { AusgeblendeteListe } from './AusgeblendeteListe'
import type { AusgeblendetEintrag } from './AusgeblendeteListe'

// useMutation wird nicht wirklich ausgeloest — mock gibt loading=false zurueck.
// Wieder-Einblenden nutzt UPDATE_APPLICATION (nicht DELETE), der Mock ist neutral.
jest.mock('@apollo/client/react', () => ({
  useMutation: () => [jest.fn().mockResolvedValue({}), { loading: false }],
}))

const eintraege: AusgeblendetEintrag[] = [
  {
    id: 'e1',
    medium_id: 'bajour',
    stiftung_id: '100',
    stiftung_name: 'Stiftung Testweise',
    bemerkung: 'Ausgeblendet: Stiftung Testweise. Grund: Passt inhaltlich nicht. Kein Regionalbezug.',
    date_created: '2026-06-10T09:00:00',
  },
  {
    id: 'e2',
    medium_id: 'wepublish',
    stiftung_id: '200',
    stiftung_name: 'Fondation Exemple',
    bemerkung: 'Ausgeblendet: Fondation Exemple. Grund: Anderer Grund.',
    date_created: '2026-06-11T08:00:00',
  },
]

test('rendert nichts wenn eintraege leer', () => {
  const { container } = render(<AusgeblendeteListe eintraege={[]} onRefetch={() => {}} />)
  expect(container.firstChild).toBeNull()
})

test('zeigt Kopfzeile mit Anzahl, standardmaessig eingeklappt', () => {
  render(<AusgeblendeteListe eintraege={eintraege} onRefetch={() => {}} />)
  expect(screen.getByRole('button', { name: /Ausgeblendet \(2\)/i })).toBeInTheDocument()
  // Inhalte noch nicht sichtbar (eingeklappt)
  expect(screen.queryByText('Stiftung Testweise')).not.toBeInTheDocument()
})

test('zeigt N Zeilen nach Aufklappen mit Stiftungsname, Medium, Grund und Wieder-Einblenden', () => {
  render(<AusgeblendeteListe eintraege={eintraege} onRefetch={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Ausgeblendet \(2\)/i }))

  expect(screen.getByText('Stiftung Testweise')).toBeInTheDocument()
  expect(screen.getByText('Fondation Exemple')).toBeInTheDocument()

  // Medium-Slug
  expect(screen.getByText('bajour')).toBeInTheDocument()
  // Bemerkung (Ausblende-Grund) sichtbar
  expect(screen.getByText(/Passt inhaltlich nicht/)).toBeInTheDocument()

  // Je ein Wieder-Einblenden-Knopf pro Eintrag
  const buttons = screen.getAllByRole('button', { name: /Wieder einblenden/i })
  expect(buttons).toHaveLength(2)
})

test('Wieder-Einblenden-Knopf ruft onRefetch nach Mutation auf', async () => {
  const onRefetch = jest.fn()
  render(<AusgeblendeteListe eintraege={eintraege} onRefetch={onRefetch} />)

  fireEvent.click(screen.getByRole('button', { name: /Ausgeblendet \(2\)/i }))
  const buttons = screen.getAllByRole('button', { name: /Wieder einblenden/i })
  fireEvent.click(buttons[0])

  // Mutation ist gemockt als sofort resolving — einen Tick warten
  await new Promise(r => setTimeout(r, 0))
  expect(onRefetch).toHaveBeenCalledTimes(1)
})
