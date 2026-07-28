/**
 * Routen-Tests für /api/portal/marke/<datei>.
 *
 * Diese Route existiert, weil Cloudflare Access Dateien direkt unter `/` nicht
 * durchlässt und im Medien-Portal darum ein kaputtes Bild stand (Befund
 * 28.07.2026). Getestet wird beides: dass die Markenbilder wirklich ausgeliefert
 * werden, und dass die Whitelist die Route nicht zu einem Leseloch macht — ein
 * Handler, der Dateinamen aus der URL nimmt und vom Dateisystem liest, ist genau
 * die Stelle, an der ein Pfadausbruch entstehen würde.
 *
 * Relativer Pfad im Import (nicht '@/pages/...'), Muster wie beilage-routen.test.ts.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import marke from '../pages/api/portal/marke/[datei]'

function makeRes() {
  const headers: Record<string, string> = {}
  let status = 200
  let gesendet: unknown
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v
    },
    status: (c: number) => {
      status = c
      return res
    },
    send: (b: unknown) => {
      gesendet = b
      return res
    },
    end: () => res,
  } as unknown as NextApiResponse
  return {
    res,
    get status() {
      return status
    },
    get gesendet() {
      return gesendet
    },
    headers,
  }
}

function ruf(datei: unknown, method = 'GET') {
  const r = makeRes()
  const req = { method, query: { datei } } as unknown as NextApiRequest
  marke(req, r.res)
  return r
}

describe('/api/portal/marke/<datei>', () => {
  it('liefert ein erlaubtes Markenbild als PNG mit langem Cache aus', () => {
    const r = ruf('icon-192.png')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('image/png')
    expect(Buffer.isBuffer(r.gesendet)).toBe(true)
    expect((r.gesendet as Buffer).length).toBeGreaterThan(0)
    // PNG-Signatur: die Route liefert wirklich ein Bild, keine Fehlerseite.
    expect((r.gesendet as Buffer).subarray(1, 4).toString()).toBe('PNG')
    expect(r.headers['cache-control']).toContain('immutable')
  })

  it('liefert alle in der Whitelist genannten Dateien', () => {
    for (const d of ['icon-192.png', 'logo.png', 'logo-weiss.png', 'favicon-32.png', 'apple-touch-icon.png']) {
      expect(ruf(d).status).toBe(200)
    }
  })

  it('antwortet auf eine unbekannte Datei mit 404', () => {
    expect(ruf('gibtsnicht.png').status).toBe(404)
  })

  it('laesst keinen Pfadausbruch zu', () => {
    for (const d of ['../../.env', '../package.json', '/etc/passwd', 'public/icon-192.png']) {
      expect(ruf(d).status).toBe(404)
    }
  })

  it('antwortet ohne Dateinamen mit 404', () => {
    expect(ruf(undefined).status).toBe(404)
  })

  it('weist andere Methoden als GET/HEAD ab', () => {
    expect(ruf('icon-192.png', 'POST').status).toBe(405)
    expect(ruf('icon-192.png', 'HEAD').status).toBe(200)
  })
})
