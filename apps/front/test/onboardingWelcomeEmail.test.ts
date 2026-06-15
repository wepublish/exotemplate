import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildWelcomeEmailBody,
  type WelcomeEmailParams,
  type WelcomeEmailTranslate
} from '../app/utils/onboardingWelcomeEmail'

// Fake translate: echoes the relative key (and interpolations) so we can assert
// the assembly/conditional logic without a vue-i18n runtime.
const t: WelcomeEmailTranslate = (key, named) => {
  switch (key) {
    case 'fallbackName':
      return 'FALLBACK'
    case 'greeting':
      return `GREET:${named?.name}`
    case 'activate':
      return `ACTIVATE:${named?.url}`
    case 'login':
      return `LOGIN:${named?.url}`
    case 'sharedChannel':
      return `CHANNEL:${named?.channel}`
    default:
      return key.toUpperCase()
  }
}

const base: WelcomeEmailParams = {
  firstName: 'Max',
  oneUrl: 'https://one.example',
  activationUrl: 'https://one.example/accept?token=abc',
  loginUrl: 'https://one.example/auth/login',
  jiraUrl: 'https://jira.example/ABC',
  slackUrl: 'https://slack.example/C1',
  slackChannelName: 'general',
  editorUrl: 'https://editor.example'
}

describe('buildWelcomeEmailBody (assembly)', () => {
  it('opens with the greeting and includes every section', () => {
    const body = buildWelcomeEmailBody(t, base)
    expect(body.startsWith('GREET:Max')).toBe(true)
    for (const key of [
      'INTRO',
      'ONETITLE',
      'ONETEXT',
      'JIRATITLE',
      'JIRATEXT',
      'SLACKTITLE',
      'SLACKTEXT',
      'EDITORTITLE',
      'EDITORTEXT',
      'SUMMARY',
      'ACTIVATEOUTRO',
      'MEETING',
      'CLOSING'
    ]) {
      expect(body).toContain(key)
    }
  })

  it('embeds all provided links', () => {
    const body = buildWelcomeEmailBody(t, base)
    expect(body).toContain(base.oneUrl)
    expect(body).toContain(base.jiraUrl)
    expect(body).toContain(base.slackUrl)
    expect(body).toContain(base.editorUrl)
  })

  it('uses the activation line when an activation url is present', () => {
    const body = buildWelcomeEmailBody(t, base)
    expect(body).toContain(`ACTIVATE:${base.activationUrl}`)
    expect(body).not.toContain('LOGIN:')
  })

  it('falls back to the login line when there is no activation url', () => {
    const body = buildWelcomeEmailBody(t, { ...base, activationUrl: null })
    expect(body).toContain(`LOGIN:${base.loginUrl}`)
    expect(body).not.toContain('ACTIVATE:')
  })

  it('includes the shared channel line only when a channel name is given', () => {
    expect(buildWelcomeEmailBody(t, base)).toContain('CHANNEL:general')
    const without = buildWelcomeEmailBody(t, {
      ...base,
      slackChannelName: null
    })
    expect(without).not.toContain('CHANNEL:')
    expect(without).toContain(base.slackUrl)
  })

  it('uses the localized fallback name when no first name is given', () => {
    expect(buildWelcomeEmailBody(t, { ...base, firstName: '  ' })).toContain(
      'GREET:FALLBACK'
    )
  })
})

describe('welcome email catalog', () => {
  const localesDir = fileURLToPath(new URL('../i18n/locales', import.meta.url))
  const load = (locale: string) =>
    JSON.parse(readFileSync(`${localesDir}/${locale}/onboarding.json`, 'utf8'))
      .onboarding.steps.email.welcome

  it('defines subject + interpolated greeting/activate/sharedChannel per locale', () => {
    for (const locale of ['de', 'fr', 'en']) {
      const w = load(locale)
      expect(w.subject.length).toBeGreaterThan(0)
      expect(w.greeting).toContain('{name}')
      expect(w.activate).toContain('{url}')
      expect(w.login).toContain('{url}')
      expect(w.sharedChannel).toContain('{channel}')
    }
  })
})
