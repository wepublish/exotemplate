import { baueBereitschaft, type MediumRoh } from './bereitschaft'

const m = (slug: string, slack: string | null, mails: unknown): MediumRoh => ({
  slug,
  slack_channel: slack,
  kontakt_emails: mails,
})

test('alles vorhanden -> startklar, keine Luecken', () => {
  const r = baueBereitschaft([m('bajour', 'C123', ['a@b.ch'])], new Set(['bajour']), true)
  expect(r.alleBereit).toBe(true)
  expect(r.luecken).toEqual([])
})

test('fehlender Slack-Kanal und fehlende DNA werden benannt', () => {
  const r = baueBereitschaft(
    [m('bajour', null, ['a@b.ch']), m('cueltuer', 'C9', [])],
    new Set(['bajour']),
    true,
  )
  expect(r.alleBereit).toBe(false)
  const byMedium = Object.fromEntries(r.luecken.map((l) => [l.slug, l.fehlt]))
  expect(byMedium['bajour']).toContain('Slack-Kanal')
  expect(byMedium['cueltuer']).toContain('DNA')
  expect(byMedium['cueltuer']).toContain('Kontakt-Mails')
})

test('fehlendes Gmail wird global gemeldet', () => {
  const r = baueBereitschaft([m('bajour', 'C1', ['a@b.ch'])], new Set(['bajour']), false)
  expect(r.alleBereit).toBe(false)
  expect(r.gmailFehlt).toBe(true)
})

test('kontakt_emails als JSON-String wird toleriert', () => {
  const r = baueBereitschaft([m('bajour', 'C1', '["a@b.ch"]')], new Set(['bajour']), true)
  expect(r.alleBereit).toBe(true)
})
