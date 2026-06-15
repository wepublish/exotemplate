import type { SlackLocale } from './locale'

export interface WarningLineArgs {
  url: string
  key: string
  /** Formatted estimate hours, e.g. "5 h". */
  estimate: string
  /** Formatted used hours. */
  used: string
  /** Used percent as a raw integer. */
  usedPercent: number
  /** Formatted initial-threshold hours. */
  initialThreshold: string
  /** Formatted next-threshold hours. */
  nextThreshold: string
}

export interface HaltArgs {
  url: string
  key: string
  clientName: string
  /** Already-formatted actor (name/email). */
  actor: string
  /** Already-formatted timestamp. */
  occurredAt: string
}

export interface NotificationsCopy {
  /** Fallback label when an actor has neither name nor email. */
  unknownActor: string
  warning: {
    blockHeader: string
    header: (clientName: string, count: number) => string
    line: (a: WarningLineArgs) => string
    stopButton: string
    footer: string
    fallbackLine: (a: WarningLineArgs) => string
  }
  haltRequested: {
    header: string
    headline: (a: Pick<HaltArgs, 'url' | 'key' | 'clientName'>) => string
    detail: (a: Pick<HaltArgs, 'actor' | 'occurredAt'>) => string
    button: string
    context: (a: Pick<HaltArgs, 'clientName' | 'url' | 'key'>) => string
    fallback: (a: HaltArgs) => string
  }
  haltResolved: {
    header: string
    headline: (a: Pick<HaltArgs, 'url' | 'key' | 'clientName'>) => string
    detail: (a: Pick<HaltArgs, 'actor' | 'occurredAt'>) => string
    button: string
    fallback: (a: HaltArgs) => string
  }
}

export const NOTIFICATIONS_COPY: Record<SlackLocale, NotificationsCopy> = {
  de: {
    unknownActor: 'Unbekannt',
    warning: {
      blockHeader: 'Budget-Warnung',
      header: (c, n) =>
        `Freundlicher Hinweis für ${c}: ${n} Jira-Ticket${n === 1 ? '' : 's'} ` +
        `${n === 1 ? 'hat' : 'haben'} einen Schwellenwert überschritten.`,
      line: (a) =>
        `*<${a.url}|${a.key}>* — Schätzung: ${a.estimate}, ` +
        `verbraucht: ${a.used} (${a.usedPercent}%).\n` +
        `_Erste Meldung ab ${a.initialThreshold} Nächste Meldung ab ${a.nextThreshold}._`,
      stopButton: 'Arbeit stoppen oder prüfen',
      footer:
        'Im Dashboard kannst Du die Arbeit an einem Ticket stoppen, bis ' +
        'Rücksprache erfolgt ist, oder die Warnung dauerhaft stummschalten. ' +
        'Andernfalls meldet sich der Bot automatisch bei der nächsten ' +
        'Schwelle wieder.',
      fallbackLine: (a) =>
        `• ${a.key}: ${a.used} / ${a.estimate} (${a.usedPercent}%) — ` +
        `erste Schwelle ${a.initialThreshold}, nächste Meldung ab ${a.nextThreshold}`
    },
    haltRequested: {
      header: 'Arbeitsstopp angefordert',
      headline: (a) =>
        `:octagonal_sign: Arbeitsstopp für *<${a.url}|${a.key}>* (${a.clientName})`,
      detail: (a) =>
        `${a.actor} hat am ${a.occurredAt} einen Arbeitsstopp angefordert.\n` +
        '*@We.Publish bitte stellt die Arbeit an diesem Ticket sofort ein.* ' +
        `@${a.actor} bitte nimm mit dem Projektverantwortlichen Kontakt auf, um das weitere Vorgehen gemeinsam zu besprechen.`,
      button: 'Im Dashboard ansehen',
      context: (a) =>
        `Erst wenn ${a.clientName} den Stop aufhebt, darf an <${a.url}|${a.key}> weitergearbeitet werden.`,
      fallback: (a) =>
        `ARBEITSSTOPP: ${a.key} (${a.clientName}). ${a.actor} hat am ${a.occurredAt} ` +
        'einen Arbeitsstopp angefordert. Bitte stellt die Arbeit sofort ein, bis der ' +
        'Stopp im Dashboard aufgehoben wird.'
    },
    haltResolved: {
      header: 'Arbeitsstopp aufgehoben',
      headline: (a) =>
        `:white_check_mark: Arbeitsstopp aufgehoben für *<${a.url}|${a.key}>* (${a.clientName})`,
      detail: (a) =>
        `${a.actor} hat den Arbeitsstopp am ${a.occurredAt} aufgehoben.\n` +
        'Die Arbeit an diesem Ticket darf wieder aufgenommen werden.',
      button: 'Im Dashboard ansehen',
      fallback: (a) =>
        `Arbeitsstopp für ${a.key} (${a.clientName}) wurde von ${a.actor} ` +
        `am ${a.occurredAt} aufgehoben. Die Arbeit an diesem Ticket kann wieder aufgenommen werden.`
    }
  },
  fr: {
    unknownActor: 'Inconnu',
    warning: {
      blockHeader: 'Alerte budget',
      header: (c, n) =>
        `Information pour ${c} : ${n} ticket${n === 1 ? '' : 's'} Jira ` +
        `${n === 1 ? 'a' : 'ont'} dépassé un seuil.`,
      line: (a) =>
        `*<${a.url}|${a.key}>* — Estimation : ${a.estimate}, ` +
        `consommé : ${a.used} (${a.usedPercent}%).\n` +
        `_Première alerte à partir de ${a.initialThreshold} Prochaine alerte à partir de ${a.nextThreshold}._`,
      stopButton: 'Arrêter ou vérifier le travail',
      footer:
        'Dans le tableau de bord, tu peux arrêter le travail sur un ticket ' +
        'jusqu’à clarification, ou mettre l’alerte en sourdine durablement. ' +
        'Sinon, le bot se manifestera automatiquement au prochain seuil.',
      fallbackLine: (a) =>
        `• ${a.key} : ${a.used} / ${a.estimate} (${a.usedPercent}%) — ` +
        `premier seuil ${a.initialThreshold}, prochaine alerte à partir de ${a.nextThreshold}`
    },
    haltRequested: {
      header: 'Arrêt de travail demandé',
      headline: (a) =>
        `:octagonal_sign: Arrêt de travail pour *<${a.url}|${a.key}>* (${a.clientName})`,
      detail: (a) =>
        `${a.actor} a demandé un arrêt de travail le ${a.occurredAt}.\n` +
        '*@We.Publish merci d’arrêter immédiatement le travail sur ce ticket.* ' +
        `@${a.actor} merci de prendre contact avec le responsable de projet pour convenir ensemble de la suite.`,
      button: 'Voir dans le tableau de bord',
      context: (a) =>
        `Le travail sur <${a.url}|${a.key}> ne peut reprendre qu’une fois que ${a.clientName} a levé l’arrêt.`,
      fallback: (a) =>
        `ARRÊT DE TRAVAIL : ${a.key} (${a.clientName}). ${a.actor} a demandé un arrêt de travail le ${a.occurredAt}. ` +
        'Merci d’arrêter le travail immédiatement, jusqu’à la levée de l’arrêt dans le tableau de bord.'
    },
    haltResolved: {
      header: 'Arrêt de travail levé',
      headline: (a) =>
        `:white_check_mark: Arrêt de travail levé pour *<${a.url}|${a.key}>* (${a.clientName})`,
      detail: (a) =>
        `${a.actor} a levé l’arrêt de travail le ${a.occurredAt}.\n` +
        'Le travail sur ce ticket peut reprendre.',
      button: 'Voir dans le tableau de bord',
      fallback: (a) =>
        `L’arrêt de travail pour ${a.key} (${a.clientName}) a été levé par ${a.actor} ` +
        `le ${a.occurredAt}. Le travail sur ce ticket peut reprendre.`
    }
  },
  en: {
    unknownActor: 'Unknown',
    warning: {
      blockHeader: 'Budget warning',
      header: (c, n) =>
        `Friendly heads-up for ${c}: ${n} Jira ticket${n === 1 ? '' : 's'} ` +
        `${n === 1 ? 'has' : 'have'} crossed a threshold.`,
      line: (a) =>
        `*<${a.url}|${a.key}>* — Estimate: ${a.estimate}, ` +
        `used: ${a.used} (${a.usedPercent}%).\n` +
        `_First notification from ${a.initialThreshold} Next notification from ${a.nextThreshold}._`,
      stopButton: 'Stop or review work',
      footer:
        'In the dashboard you can stop work on a ticket until things are ' +
        'clarified, or mute the warning permanently. Otherwise the bot will ' +
        'check in again automatically at the next threshold.',
      fallbackLine: (a) =>
        `• ${a.key}: ${a.used} / ${a.estimate} (${a.usedPercent}%) — ` +
        `first threshold ${a.initialThreshold}, next notification from ${a.nextThreshold}`
    },
    haltRequested: {
      header: 'Work stop requested',
      headline: (a) =>
        `:octagonal_sign: Work stop for *<${a.url}|${a.key}>* (${a.clientName})`,
      detail: (a) =>
        `${a.actor} requested a work stop on ${a.occurredAt}.\n` +
        '*@We.Publish please stop work on this ticket immediately.* ' +
        `@${a.actor} please get in touch with the project lead to agree on how to proceed together.`,
      button: 'View in dashboard',
      context: (a) =>
        `Work on <${a.url}|${a.key}> may only resume once ${a.clientName} lifts the stop.`,
      fallback: (a) =>
        `WORK STOP: ${a.key} (${a.clientName}). ${a.actor} requested a work stop on ${a.occurredAt}. ` +
        'Please stop work immediately, until the stop is lifted in the dashboard.'
    },
    haltResolved: {
      header: 'Work stop lifted',
      headline: (a) =>
        `:white_check_mark: Work stop lifted for *<${a.url}|${a.key}>* (${a.clientName})`,
      detail: (a) =>
        `${a.actor} lifted the work stop on ${a.occurredAt}.\n` +
        'Work on this ticket may resume.',
      button: 'View in dashboard',
      fallback: (a) =>
        `The work stop for ${a.key} (${a.clientName}) was lifted by ${a.actor} ` +
        `on ${a.occurredAt}. Work on this ticket may resume.`
    }
  }
}
