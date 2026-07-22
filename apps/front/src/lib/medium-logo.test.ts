/**
 * Unit-Tests für domain-Extraktion und Link-Rel-Parsing.
 */

import { domainAusUrl, parseLinkRelIcon } from '../pages/api/medium-logo'

describe('domainAusUrl', () => {
  it('extrahiert domain aus vollständiger https-URL', () => {
    expect(domainAusUrl('https://www.wepublish.ch/about')).toBe('www.wepublish.ch')
  })

  it('extrahiert domain aus URL ohne Pfad', () => {
    expect(domainAusUrl('https://bajour.ch')).toBe('bajour.ch')
  })

  it('fügt https:// hinzu wenn kein Protokoll vorhanden', () => {
    expect(domainAusUrl('example.com')).toBe('example.com')
  })

  it('gibt null bei leerem String zurück', () => {
    expect(domainAusUrl('')).toBe(null)
  })
})

describe('parseLinkRelIcon', () => {
  const basis = 'https://example.com'

  it('findet rel="icon"', () => {
    const html = '<head><link rel="icon" href="/favicon.png"></head>'
    expect(parseLinkRelIcon(html, basis)).toBe('https://example.com/favicon.png')
  })

  it('findet rel="shortcut icon"', () => {
    const html = '<link rel="shortcut icon" href="/icons/favicon.ico">'
    expect(parseLinkRelIcon(html, basis)).toBe('https://example.com/icons/favicon.ico')
  })

  it('findet rel="apple-touch-icon"', () => {
    const html = '<link rel="apple-touch-icon" href="/apple-touch-icon.png">'
    expect(parseLinkRelIcon(html, basis)).toBe('https://example.com/apple-touch-icon.png')
  })

  it('löst absolute URL direkt auf', () => {
    const html = '<link rel="icon" href="https://cdn.example.com/favicon.png">'
    expect(parseLinkRelIcon(html, basis)).toBe('https://cdn.example.com/favicon.png')
  })

  it('überspringt data:-URLs', () => {
    const html = '<link rel="icon" href="data:image/png;base64,abc">'
    expect(parseLinkRelIcon(html, basis)).toBeNull()
  })

  it('gibt null zurück wenn kein Icon-Link vorhanden', () => {
    const html = '<head><title>Seite</title></head>'
    expect(parseLinkRelIcon(html, basis)).toBeNull()
  })

  it('ignoriert rel="stylesheet" und andere nicht-Icon-Links', () => {
    const html = `
      <link rel="stylesheet" href="/style.css">
      <link rel="canonical" href="https://example.com">
      <link rel="icon" href="/fav.ico">
    `
    expect(parseLinkRelIcon(html, basis)).toBe('https://example.com/fav.ico')
  })

  it('Attribut-Reihenfolge href vor rel funktioniert', () => {
    const html = '<link href="/fav.svg" rel="icon">'
    expect(parseLinkRelIcon(html, basis)).toBe('https://example.com/fav.svg')
  })
})
