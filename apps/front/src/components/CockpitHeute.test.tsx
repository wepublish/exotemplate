import { render, screen } from '@testing-library/react'
import { CockpitHeuteView } from './CockpitHeute'
import { baueHeute } from '@/lib/cockpit'

test('zeigt Gruss und drei Handgriffe mit Links', () => {
  const aktionen = baueHeute({ sichten: 4, freigeben: 2, nachfassen: 1, frist: 0, ausgang: 0 })
  render(<CockpitHeuteView gruss="Guten Morgen Ramona" aktionen={aktionen} />)
  expect(screen.getByText('Guten Morgen Ramona')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Antrag nachfassen/ })).toHaveAttribute('href', '/applications')
  expect(screen.getByRole('link', { name: /Förderpaket/ })).toHaveAttribute('href', '/sichten')
})

test('zeigt die Ruhe-Meldung wenn nichts ansteht', () => {
  render(<CockpitHeuteView gruss="Guten Morgen Ramona" aktionen={[]} />)
  expect(screen.getByText(/Aktuell nichts zu tun/)).toBeInTheDocument()
})
