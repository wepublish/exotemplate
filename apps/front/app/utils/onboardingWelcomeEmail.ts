/**
 * Assembles the onboarding welcome email.
 *
 * Holds NO copy — all strings live in the i18n catalogs
 * (`i18n/locales/<locale>/onboarding.json` → `onboarding.steps.email.welcome`).
 * The caller passes a `translate` function already bound to the target locale
 * (the new client user's language), so the mail renders in that language
 * regardless of the admin's active UI locale. This module only arranges the
 * pieces and applies the activation/login + Slack-channel conditionals.
 */

export interface WelcomeEmailParams {
  firstName: string
  oneUrl: string
  /** Tokenized activation link; null falls back to the plain login URL. */
  activationUrl: string | null
  loginUrl: string
  jiraUrl: string
  slackUrl: string
  /** Shared Slack channel name (without `#`); null omits the channel line. */
  slackChannelName: string | null
  editorUrl: string
}

/**
 * Translate a key relative to `onboarding.steps.email.welcome`, bound to the
 * target locale by the caller. e.g. `t('greeting', { name })`.
 */
export type WelcomeEmailTranslate = (
  key: string,
  named?: Record<string, unknown>
) => string

export function buildWelcomeEmailBody(
  t: WelcomeEmailTranslate,
  params: WelcomeEmailParams
): string {
  const name = params.firstName.trim() || t('fallbackName')
  const activationLine = params.activationUrl
    ? t('activate', { url: params.activationUrl })
    : t('login', { url: params.loginUrl })
  const slackBlock = params.slackChannelName
    ? `${params.slackUrl}\n  ${t('sharedChannel', {
        channel: params.slackChannelName
      })}`
    : `${params.slackUrl}`

  return `${t('greeting', { name })}

${t('intro')}

1.  ${t('oneTitle')}

    ${activationLine}

    ${t('oneText')}

    ${params.oneUrl}


2.  ${t('jiraTitle')}

    ${params.jiraUrl}

    ${t('jiraText')}


3.  ${t('slackTitle')}

    ${slackBlock}

    ${t('slackText')}


4.  ${t('editorTitle')}

    ${params.editorUrl}

    ${t('editorText')}
    

${t('summary')}

${t('activateOutro')}

${t('meeting')}

${t('closing')}`
}
