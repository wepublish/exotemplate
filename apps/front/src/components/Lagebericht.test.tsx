import { render, screen } from '@testing-library/react'
import { Lagebericht } from './Lagebericht'

function mockFetch(body: object) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = jest.fn().mockResolvedValue({ json: async () => body }) as any
}

test('zeigt Morgenbriefing mit To-dos und Ein-Klick-Buttons', async () => {
  mockFetch({
    status: 'ok',
    briefing: {
      gruss: 'Guten Morgen!',
      todos: [
        { text: 'neue_wege die Matching-Liste schicken', aktion: 'matching_liste', medium: 'neue_wege' },
        { text: 'ganzgraz ans Auffuellen der Datensuppe erinnern', aktion: 'datensuppe', medium: 'ganzgraz' },
      ],
    },
  })
  render(<Lagebericht vorschlaege={[]} />)
  expect(await screen.findByText('Guten Morgen!')).toBeInTheDocument()
  expect(screen.getByText('neue_wege die Matching-Liste schicken')).toBeInTheDocument()
  expect(screen.getByText(/Liste öffnen/).closest('a')).toHaveAttribute('href', '/?medium=neue_wege')
  expect(screen.getByText(/Onboarding/).closest('a')).toHaveAttribute('href', '/onboarding')
})

test('Fallback wenn das Briefing nicht verfügbar ist', async () => {
  mockFetch({ status: 'error', note: 'x' })
  render(<Lagebericht vorschlaege={[]} />)
  expect(await screen.findByText(/nicht verfügbar/)).toBeInTheDocument()
})
