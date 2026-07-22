import { render, screen } from '@testing-library/react'
import { BereitschaftView } from './BereitschaftStreifen'

test('startklar-Zustand', () => {
  render(<BereitschaftView b={{ alleBereit: true, gmailFehlt: false, luecken: [] }} anzahl={7} />)
  expect(screen.getByText(/Alle 7 Medien startklar/)).toBeInTheDocument()
})

test('benennt Luecken und fehlendes Gmail', () => {
  render(
    <BereitschaftView
      b={{ alleBereit: false, gmailFehlt: true, luecken: [{ slug: 'bajour', fehlt: ['Slack-Kanal'] }] }}
      anzahl={7}
    />,
  )
  expect(screen.getByText(/bajour/)).toBeInTheDocument()
  expect(screen.getByText(/Slack-Kanal/)).toBeInTheDocument()
  expect(screen.getByText(/Gmail/)).toBeInTheDocument()
})
