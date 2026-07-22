import { render, screen, fireEvent } from '@testing-library/react'
import { CockpitHeader } from './CockpitHeader'

test('zeigt den Ein-Satz und blendet die Erklaerung erst auf Klick ein', () => {
  render(<CockpitHeader />)
  expect(screen.getByText(/Dein Teil: sichten, freigeben, senden/)).toBeInTheDocument()
  expect(screen.queryByText(/findet das System Förderstiftungen/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /So läuft/ }))
  expect(screen.getByText(/findet das System Förderstiftungen/)).toBeInTheDocument()
})
