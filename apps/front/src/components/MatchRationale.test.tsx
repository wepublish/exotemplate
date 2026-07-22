/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import { MatchRationale } from './MatchRationale'

test('zeigt top-tags und konfidenz-warnung', () => {
  render(
    <MatchRationale
      row={{
        tags: [{ tag_slug: 'pressefreiheit', gewicht: 3, begruendung: 'b' }],
        soundFeeling: 'sf',
        schaerfe: 50,
        konfidenz: 'stammdaten',
        score: 80,
        breakdown: {},
        id: '1',
        stiftungId: '9',
        name: 'X',
      } as any}
    />
  )
  expect(screen.getByText(/pressefreiheit/)).toBeInTheDocument()
  expect(screen.getByText(/Stammdaten/i)).toBeInTheDocument()
})
