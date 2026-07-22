export type Zaehler = {
  sichten: number
  freigeben: number
  nachfassen: number
  frist: number
  ausgang: number
}

export type Handgriff = {
  key: 'frist' | 'nachfassen' | 'freigeben' | 'sichten' | 'ausgang'
  titel: string
  sub: string
  anzahl: number
  href: string
  dringend: boolean
}

// Reihenfolge = Prioritaet (oben = dringlichster). Texte sind Ramona-tauglich,
// Schweizer Orthografie, keine Fachbegriffe.
const DEFS: {
  key: Handgriff['key']
  titel: (n: number) => string
  sub: string
  href: string
  dringend: boolean
}[] = [
  {
    key: 'frist',
    titel: (n) => `${n} Frist${n === 1 ? '' : 'en'} im Blick behalten`,
    sub: 'Ausschreibung läuft bald ab',
    href: '/matching-ausschreibungen',
    dringend: true,
  },
  {
    key: 'nachfassen',
    titel: (n) => `${n} Antrag${n === 1 ? '' : 'e'} nachfassen`,
    sub: 'Eingereicht, seit Tagen keine Antwort',
    href: '/applications',
    dringend: true,
  },
  {
    key: 'ausgang',
    titel: (n) => `${n} Antrag${n === 1 ? '' : 'e'}: Ausgang nachtragen`,
    sub: 'Lange in Arbeit — eingereicht, Zusage oder Absage erfassen',
    href: '/applications',
    dringend: false,
  },
  {
    key: 'freigeben',
    titel: (n) => `${n} Entwurf${n === 1 ? '' : 'e'} freigeben und senden`,
    sub: 'Vorbereitet, warten auf dein OK',
    href: '/freigabe',
    dringend: false,
  },
  {
    key: 'sichten',
    titel: (n) => `${n} neue${n === 1 ? 's' : ''} Förderpaket${n === 1 ? '' : 'e'} sichten`,
    sub: 'Pro Karte: passt / später / passt nicht',
    href: '/sichten',
    dringend: false,
  },
]

/** Baut die priorisierte Liste der Handgriffe; nur Kategorien mit anzahl > 0. */
export function baueHeute(z: Zaehler): Handgriff[] {
  return DEFS.filter((d) => z[d.key] > 0).map((d) => ({
    key: d.key,
    titel: d.titel(z[d.key]),
    sub: d.sub,
    anzahl: z[d.key],
    href: d.href,
    dringend: d.dringend,
  }))
}
