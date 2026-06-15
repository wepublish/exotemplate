import type { BudgetStatus } from '../weekly-report/progress'
import type { SlackLocale } from './locale'

export interface WeeklyStatusBodyArgs {
  /** Formatted budget-used percent, e.g. "92 %". */
  used: string
  /** Formatted time-elapsed percent. */
  time: string
  /** Formatted absolute delta percent. */
  absDelta: string
  /** Formatted total used hours, e.g. "2.5 h". */
  hours: string
}

interface StatusCopy {
  emoji: string
  headline: (clientName: string) => string
  body: (args: WeeklyStatusBodyArgs) => string
}

export interface WeeklyReportCopy {
  header: string
  periodWord: string
  daysRemainingLabel: string
  /** Connector in "X von Y" remaining-days line. */
  daysConnector: string
  status: Record<BudgetStatus, StatusCopy>
  usedHoursLabel: string
  separatelyBilledNote: string
  topUpBudgetLabel: string
  timeLabel: string
  budgetLabel: string
  availableLabel: string
  dashboardButton: string
  footerNote: string
  fallbackNoBudget: (args: {
    headline: string
    hours: string
    periodLabel: string
  }) => string
  fallbackNormal: (args: {
    headline: string
    budgetPercent: string
    timePercent: string
    available: string
    periodLabel: string
  }) => string
  monthly: {
    headline: (clientName: string) => string
    bodyOpen: (hours: string) => string
    bodyNone: string
    toBillLabel: string
    fallback: (args: {
      clientName: string
      hours: string
      periodLabel: string
    }) => string
  }
}

export const WEEKLY_REPORT_COPY: Record<SlackLocale, WeeklyReportCopy> = {
  de: {
    header: 'Wöchentlicher Projektbericht',
    periodWord: 'Periode',
    daysRemainingLabel: 'Verbleibende Tage',
    daysConnector: 'von',
    status: {
      no_budget: {
        emoji: ':warning:',
        headline: (c) => `Kein Budget hinterlegt – ${c}`,
        body: (a) =>
          `Es wurden bereits ${a.hours} erfasst, aber für diese Periode ist noch ` +
          'kein Top-Up hinterlegt. Diese Stunden werden separat in Rechnung gestellt, sofern kein Budget nachgetragen wird. ' +
          'Bitte mit dem Projektverantwortlichen klären.'
      },
      over_budget: {
        emoji: ':rotating_light:',
        headline: (c) => `Budget überschritten – ${c}`,
        body: (a) =>
          `Das Budget ist mit ${a.used} bereits über 100 % aufgebraucht ` +
          `(Zeit: ${a.time}). Bitte umgehend Rücksprache mit dem Projektverantwortlichen nehmen ` +
          'und das weitere Vorgehen abstimmen.'
      },
      close_to_limit: {
        emoji: ':warning:',
        headline: (c) => `Budget fast aufgebraucht – ${c}`,
        body: (a) =>
          `${a.used} des Budgets sind verbraucht, während ${a.time} der Zeit ` +
          'vergangen sind. Bitte plant die letzten Stunden bewusst und meldet euch frühzeitig, ' +
          'falls eine Aufstockung nötig ist.'
      },
      behind_schedule: {
        emoji: ':hourglass_flowing_sand:',
        headline: (c) => `Budget verbraucht sich schneller als erwartet – ${c}`,
        body: (a) =>
          `${a.used} des Budgets sind weg, aber erst ${a.time} der Periode sind vorbei ` +
          `(${a.absDelta} schneller als geplant). Schaut, ob ihr im Tempo etwas runter könnt ` +
          'oder ob das Budget angepasst werden muss.'
      },
      ahead_of_schedule: {
        emoji: ':white_check_mark:',
        headline: (c) => `Alles im grünen Bereich – ${c}`,
        body: (a) =>
          `Erst ${a.used} des Budgets sind genutzt, obwohl ${a.time} der Periode ` +
          `vorbei sind (${a.absDelta} unter Plan). Aktuell besteht reichlich Spielraum.`
      },
      on_track: {
        emoji: ':chart_with_upwards_trend:',
        headline: (c) => `Budget und Zeit im Gleichlauf – ${c}`,
        body: (a) =>
          `${a.used} des Budgets sind verbraucht, ${a.time} der Zeit sind vergangen. ` +
          'Alles im erwarteten Rahmen.'
      }
    },
    usedHoursLabel: 'Verbrauchte Stunden',
    separatelyBilledNote: 'werden separat verrechnet',
    topUpBudgetLabel: 'Top-Up-Budget',
    timeLabel: 'Zeit',
    budgetLabel: 'Budget',
    availableLabel: 'Verfügbar',
    dashboardButton: 'Dashboard öffnen',
    footerNote:
      'Dieser Bericht wird einmal pro Woche automatisch erstellt. ' +
      'Im Dashboard kann er pro Projekt stummgeschaltet werden.',
    fallbackNoBudget: (a) =>
      `${a.headline}: ${a.hours} erfasst, kein Top-Up hinterlegt (${a.periodLabel}).`,
    fallbackNormal: (a) =>
      `${a.headline}: ${a.budgetPercent} Budget / ${a.timePercent} Zeit. ` +
      `Verfügbar: ${a.available} (${a.periodLabel}).`,
    monthly: {
      headline: (c) => `:receipt: *Aktueller Abrechnungsstand – ${c}*`,
      bodyOpen: (h) =>
        `Aktuell sind *${h}* offen, die am Periodenende monatlich in Rechnung gestellt werden.`,
      bodyNone: 'Aktuell sind keine offenen Stunden zu verrechnen.',
      toBillLabel: 'Aktuell zu verrechnen',
      fallback: (a) =>
        `Abrechnungsstand ${a.clientName}: ${a.hours} ` +
        `werden monatlich verrechnet (${a.periodLabel}).`
    }
  },
  fr: {
    header: 'Rapport hebdomadaire du projet',
    periodWord: 'Période',
    daysRemainingLabel: 'Jours restants',
    daysConnector: 'sur',
    status: {
      no_budget: {
        emoji: ':warning:',
        headline: (c) => `Aucun budget enregistré – ${c}`,
        body: (a) =>
          `${a.hours} ont déjà été saisies, mais aucun top-up n'est encore enregistré ` +
          'pour cette période. Ces heures seront facturées séparément si aucun budget n’est ajouté. ' +
          'Merci de clarifier avec le responsable de projet.'
      },
      over_budget: {
        emoji: ':rotating_light:',
        headline: (c) => `Budget dépassé – ${c}`,
        body: (a) =>
          `Le budget est déjà consommé à plus de 100 % avec ${a.used} ` +
          `(temps : ${a.time}). Merci de prendre rapidement contact avec le responsable de projet ` +
          'et de convenir de la suite.'
      },
      close_to_limit: {
        emoji: ':warning:',
        headline: (c) => `Budget presque épuisé – ${c}`,
        body: (a) =>
          `${a.used} du budget sont consommés, alors que ${a.time} du temps ` +
          'se sont écoulés. Merci de planifier consciemment les dernières heures et de signaler tôt ' +
          'si une augmentation est nécessaire.'
      },
      behind_schedule: {
        emoji: ':hourglass_flowing_sand:',
        headline: (c) => `Le budget se consomme plus vite que prévu – ${c}`,
        body: (a) =>
          `${a.used} du budget sont partis, mais seulement ${a.time} de la période se sont écoulés ` +
          `(${a.absDelta} plus vite que prévu). Voyez si vous pouvez ralentir un peu le rythme ` +
          'ou s’il faut ajuster le budget.'
      },
      ahead_of_schedule: {
        emoji: ':white_check_mark:',
        headline: (c) => `Tout est au vert – ${c}`,
        body: (a) =>
          `Seulement ${a.used} du budget sont utilisés, bien que ${a.time} de la période ` +
          `soient écoulés (${a.absDelta} en dessous du plan). Il reste actuellement une marge confortable.`
      },
      on_track: {
        emoji: ':chart_with_upwards_trend:',
        headline: (c) => `Budget et temps alignés – ${c}`,
        body: (a) =>
          `${a.used} du budget sont consommés, ${a.time} du temps se sont écoulés. ` +
          'Tout est dans le cadre attendu.'
      }
    },
    usedHoursLabel: 'Heures consommées',
    separatelyBilledNote: 'seront facturées séparément',
    topUpBudgetLabel: 'Budget top-up',
    timeLabel: 'Temps',
    budgetLabel: 'Budget',
    availableLabel: 'Disponible',
    dashboardButton: 'Ouvrir le tableau de bord',
    footerNote:
      'Ce rapport est généré automatiquement une fois par semaine. ' +
      'Il peut être désactivé par projet dans le tableau de bord.',
    fallbackNoBudget: (a) =>
      `${a.headline} : ${a.hours} saisies, aucun top-up enregistré (${a.periodLabel}).`,
    fallbackNormal: (a) =>
      `${a.headline} : ${a.budgetPercent} budget / ${a.timePercent} temps. ` +
      `Disponible : ${a.available} (${a.periodLabel}).`,
    monthly: {
      headline: (c) => `:receipt: *État de facturation actuel – ${c}*`,
      bodyOpen: (h) =>
        `Actuellement, *${h}* sont en attente et seront facturées mensuellement en fin de période.`,
      bodyNone: 'Actuellement, aucune heure ouverte à facturer.',
      toBillLabel: 'À facturer actuellement',
      fallback: (a) =>
        `État de facturation ${a.clientName} : ${a.hours} ` +
        `seront facturées mensuellement (${a.periodLabel}).`
    }
  },
  en: {
    header: 'Weekly project report',
    periodWord: 'Period',
    daysRemainingLabel: 'Days remaining',
    daysConnector: 'of',
    status: {
      no_budget: {
        emoji: ':warning:',
        headline: (c) => `No budget recorded – ${c}`,
        body: (a) =>
          `${a.hours} have already been logged, but no top-up has been recorded ` +
          'for this period yet. These hours will be billed separately unless a budget is added. ' +
          'Please clarify with the project lead.'
      },
      over_budget: {
        emoji: ':rotating_light:',
        headline: (c) => `Budget exceeded – ${c}`,
        body: (a) =>
          `The budget is already over 100 % used at ${a.used} ` +
          `(time: ${a.time}). Please consult the project lead immediately ` +
          'and agree on how to proceed.'
      },
      close_to_limit: {
        emoji: ':warning:',
        headline: (c) => `Budget almost used up – ${c}`,
        body: (a) =>
          `${a.used} of the budget is used, while ${a.time} of the time ` +
          'has elapsed. Please plan the remaining hours deliberately and reach out early ' +
          'if a top-up is needed.'
      },
      behind_schedule: {
        emoji: ':hourglass_flowing_sand:',
        headline: (c) => `Budget is being used up faster than expected – ${c}`,
        body: (a) =>
          `${a.used} of the budget is gone, but only ${a.time} of the period has passed ` +
          `(${a.absDelta} faster than planned). See whether you can ease the pace a little ` +
          'or whether the budget needs adjusting.'
      },
      ahead_of_schedule: {
        emoji: ':white_check_mark:',
        headline: (c) => `All in the green – ${c}`,
        body: (a) =>
          `Only ${a.used} of the budget is used, even though ${a.time} of the period ` +
          `has passed (${a.absDelta} under plan). There is plenty of headroom right now.`
      },
      on_track: {
        emoji: ':chart_with_upwards_trend:',
        headline: (c) => `Budget and time in sync – ${c}`,
        body: (a) =>
          `${a.used} of the budget is used, ${a.time} of the time has elapsed. ` +
          'Everything is within the expected range.'
      }
    },
    usedHoursLabel: 'Hours used',
    separatelyBilledNote: 'will be billed separately',
    topUpBudgetLabel: 'Top-up budget',
    timeLabel: 'Time',
    budgetLabel: 'Budget',
    availableLabel: 'Available',
    dashboardButton: 'Open dashboard',
    footerNote:
      'This report is generated automatically once a week. ' +
      'It can be muted per project in the dashboard.',
    fallbackNoBudget: (a) =>
      `${a.headline}: ${a.hours} logged, no top-up recorded (${a.periodLabel}).`,
    fallbackNormal: (a) =>
      `${a.headline}: ${a.budgetPercent} budget / ${a.timePercent} time. ` +
      `Available: ${a.available} (${a.periodLabel}).`,
    monthly: {
      headline: (c) => `:receipt: *Current billing status – ${c}*`,
      bodyOpen: (h) =>
        `Currently *${h}* are open and will be billed monthly at the end of the period.`,
      bodyNone: 'There are currently no open hours to bill.',
      toBillLabel: 'Currently to bill',
      fallback: (a) =>
        `Billing status ${a.clientName}: ${a.hours} ` +
        `will be billed monthly (${a.periodLabel}).`
    }
  }
}
