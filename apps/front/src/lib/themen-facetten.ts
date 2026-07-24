/**
 * Themen-Facetten für den Stiftungsdatenbank-Filter (Ramonas Wunsch: gezielt
 * nach Themen suchen, Kategorien ein-/ausblenden).
 *
 * Single Source of Truth: die Slugs sind EXAKT die booleschen Themen-Spalten
 * der Directus-Collection `stiftungen` (verifiziert gegen information_schema,
 * 98 Spalten in 11 Bereichen). Directus filtert serverseitig darüber
 * (`{ <slug>: { _eq: true } }`). NICHT aus vokabular_v3.json ableiten (dessen
 * Slugs weichen von den DB-Spalten ab). geo_* ist bewusst NICHT dabei — dafür
 * gibt es das eigene Land-Select.
 */

export type Facette = { slug: string; label: string }
export type BereichGruppe = { key: string; label: string; facetten: Facette[] }

export const THEMEN_GRUPPEN: BereichGruppe[] = [
  {
    key: 'medien_journalismus',
    label: 'Medien & Journalismus',
    facetten: [
      { slug: 'medien_journalismus_lokaljournalismus', label: 'Lokaljournalismus' },
      { slug: 'medien_journalismus_investigativ_recherche', label: 'Investigativ & Recherche' },
      { slug: 'medien_journalismus_kulturjournalismus', label: 'Kulturjournalismus' },
      { slug: 'medien_journalismus_sportjournalismus', label: 'Sportjournalismus' },
      { slug: 'medien_journalismus_medienvielfalt', label: 'Medienvielfalt' },
      { slug: 'medien_journalismus_pressefreiheit', label: 'Pressefreiheit' },
      { slug: 'medien_journalismus_medienkritik', label: 'Medienkritik' },
      { slug: 'medien_journalismus_open_access_no_paywall', label: 'Open Access / keine Paywall' },
      { slug: 'medien_journalismus_digitaler_wandel_medien', label: 'Digitaler Wandel der Medien' },
      { slug: 'medien_journalismus_infrastruktur_publishing', label: 'Publishing-Infrastruktur' },
      { slug: 'medien_journalismus_journalisten_ausbildung', label: 'Journalismus-Ausbildung' },
      { slug: 'medien_journalismus_innovation_medien', label: 'Medien-Innovation' },
      { slug: 'medien_journalismus_partizipativ_community', label: 'Partizipativ & Community' },
      { slug: 'medien_journalismus_unabhaengigkeit_redaktionell', label: 'Redaktionelle Unabhängigkeit' },
      { slug: 'medien_journalismus_recherchefonds', label: 'Recherchefonds' },
      { slug: 'medien_journalismus_content_sharing_netzwerk', label: 'Content-Sharing-Netzwerk' },
    ],
  },
  {
    key: 'kultur_kunst_lifestyle',
    label: 'Kultur & Kunst',
    facetten: [
      { slug: 'kultur_kunst_lifestyle_kunstfoerderung_allg', label: 'Kunstförderung allgemein' },
      { slug: 'kultur_kunst_lifestyle_kulturkritik_feuilleton', label: 'Kulturkritik & Feuilleton' },
      { slug: 'kultur_kunst_lifestyle_kulturvermittlung', label: 'Kulturvermittlung' },
      { slug: 'kultur_kunst_lifestyle_kulturteilhabe', label: 'Kulturteilhabe' },
      { slug: 'kultur_kunst_lifestyle_film_kino_video', label: 'Film, Kino & Video' },
      { slug: 'kultur_kunst_lifestyle_theater_tanz', label: 'Theater & Tanz' },
      { slug: 'kultur_kunst_lifestyle_musik_clubkultur', label: 'Musik & Clubkultur' },
      { slug: 'kultur_kunst_lifestyle_literatur_buch', label: 'Literatur & Buch' },
      { slug: 'kultur_kunst_lifestyle_bildende_kunst', label: 'Bildende Kunst' },
      { slug: 'kultur_kunst_lifestyle_architektur_baukultur', label: 'Architektur & Baukultur' },
      { slug: 'kultur_kunst_lifestyle_nischenkultur', label: 'Nischenkultur' },
      { slug: 'kultur_kunst_lifestyle_gastronomie_esskultur', label: 'Gastronomie & Esskultur' },
      { slug: 'kultur_kunst_lifestyle_interdisziplinaer_crosskultur', label: 'Interdisziplinär & Crosskultur' },
    ],
  },
  {
    key: 'soziales_inklusion',
    label: 'Soziales & Inklusion',
    facetten: [
      { slug: 'soziales_inklusion_soziale_gerechtigkeit', label: 'Soziale Gerechtigkeit' },
      { slug: 'soziales_inklusion_integration_migration', label: 'Integration & Migration' },
      { slug: 'soziales_inklusion_inklusion_behinderung', label: 'Inklusion (Behinderung)' },
      { slug: 'soziales_inklusion_lgbtiq_rechte', label: 'LGBTIQ-Rechte' },
      { slug: 'soziales_inklusion_gender_frauenfoerderung', label: 'Gender & Frauenförderung' },
      { slug: 'soziales_inklusion_chancengleichheit', label: 'Chancengleichheit' },
      { slug: 'soziales_inklusion_armutsbekaempfung', label: 'Armutsbekämpfung' },
      { slug: 'soziales_inklusion_generationendialog', label: 'Generationendialog' },
      { slug: 'soziales_inklusion_intersektionalitaet', label: 'Intersektionalität' },
      { slug: 'soziales_inklusion_marginalisierte_stimmen', label: 'Marginalisierte Stimmen' },
      { slug: 'soziales_inklusion_barrierefreiheit', label: 'Barrierefreiheit' },
      { slug: 'soziales_inklusion_empowerment', label: 'Empowerment' },
      { slug: 'soziales_inklusion_freiwilligenarbeit', label: 'Freiwilligenarbeit' },
      { slug: 'soziales_inklusion_alter_betreuung', label: 'Alter & Betreuung' },
    ],
  },
  {
    key: 'umwelt_tech_stadt',
    label: 'Umwelt, Tech & Stadt',
    facetten: [
      { slug: 'umwelt_tech_stadt_klimaschutz_nachhaltigkeit', label: 'Klimaschutz & Nachhaltigkeit' },
      { slug: 'umwelt_tech_stadt_umweltschutz', label: 'Umweltschutz' },
      { slug: 'umwelt_tech_stadt_mobilitaetswende_verkehr', label: 'Mobilitätswende & Verkehr' },
      { slug: 'umwelt_tech_stadt_stadtentwicklung_quartier', label: 'Stadtentwicklung & Quartier' },
      { slug: 'umwelt_tech_stadt_wohnen_gentrifizierung', label: 'Wohnen & Gentrifizierung' },
      { slug: 'umwelt_tech_stadt_open_source_software', label: 'Open-Source-Software' },
      { slug: 'umwelt_tech_stadt_it_digitale_transformation', label: 'IT & digitale Transformation' },
      { slug: 'umwelt_tech_stadt_wirtschaftsfoerderung', label: 'Wirtschaftsförderung' },
      { slug: 'umwelt_tech_stadt_innovation_technologie', label: 'Innovation & Technologie' },
      { slug: 'umwelt_tech_stadt_landwirtschaft_ernaehrung', label: 'Landwirtschaft & Ernährung' },
      { slug: 'umwelt_tech_stadt_tierschutz', label: 'Tierschutz' },
    ],
  },
  {
    key: 'gesellschaft_demokratie',
    label: 'Gesellschaft & Demokratie',
    facetten: [
      { slug: 'gesellschaft_demokratie_demokratiefoerderung', label: 'Demokratieförderung' },
      { slug: 'gesellschaft_demokratie_menschenrechte', label: 'Menschenrechte' },
      { slug: 'gesellschaft_demokratie_politische_bildung', label: 'Politische Bildung' },
      { slug: 'gesellschaft_demokratie_buergerbeteiligung', label: 'Bürgerbeteiligung' },
      { slug: 'gesellschaft_demokratie_transparenz_staat_wirtschaft', label: 'Transparenz (Staat & Wirtschaft)' },
      { slug: 'gesellschaft_demokratie_antidiskriminierung', label: 'Antidiskriminierung' },
      { slug: 'gesellschaft_demokratie_extremismuspraevention', label: 'Extremismusprävention' },
      { slug: 'gesellschaft_demokratie_meinungsfreiheit', label: 'Meinungsfreiheit' },
      { slug: 'gesellschaft_demokratie_zivilgesellschaft_staerkung', label: 'Zivilgesellschaft stärken' },
      { slug: 'gesellschaft_demokratie_bekaempfung_fake_news', label: 'Bekämpfung von Fake News' },
    ],
  },
  {
    key: 'bildung_wissenschaft_ethik',
    label: 'Bildung & Wissenschaft',
    facetten: [
      { slug: 'bildung_wissenschaft_ethik_bildung_allgemein', label: 'Bildung allgemein' },
      { slug: 'bildung_wissenschaft_ethik_wissenschaftsfoerderung', label: 'Wissenschaftsförderung' },
      { slug: 'bildung_wissenschaft_ethik_ethik_humanismus', label: 'Ethik & Humanismus' },
      { slug: 'bildung_wissenschaft_ethik_religion_theologie', label: 'Religion & Theologie' },
      { slug: 'bildung_wissenschaft_ethik_sozialismus_soziale_modelle', label: 'Soziale Modelle' },
      { slug: 'bildung_wissenschaft_ethik_pazifismus_frieden', label: 'Pazifismus & Frieden' },
      { slug: 'bildung_wissenschaft_ethik_aufklaerung_sensibilisierung', label: 'Aufklärung & Sensibilisierung' },
      { slug: 'bildung_wissenschaft_ethik_medienkompetenz', label: 'Medienkompetenz' },
      { slug: 'bildung_wissenschaft_ethik_berufsbildung', label: 'Berufsbildung' },
    ],
  },
  {
    key: 'sport_freizeit',
    label: 'Sport & Freizeit',
    facetten: [
      { slug: 'sport_freizeit_breitensport', label: 'Breitensport' },
      { slug: 'sport_freizeit_fussballkultur', label: 'Fussballkultur' },
      { slug: 'sport_freizeit_radsport_velokultur', label: 'Radsport & Velokultur' },
      { slug: 'sport_freizeit_sport_jugendfoerderung', label: 'Sport-Jugendförderung' },
      { slug: 'sport_freizeit_sport_frauenfoerderung', label: 'Sport-Frauenförderung' },
      { slug: 'sport_freizeit_sport_integration', label: 'Sport-Integration' },
      { slug: 'sport_freizeit_fankultur_identitaet', label: 'Fankultur & Identität' },
    ],
  },
  {
    key: 'gesundheit_praevention',
    label: 'Gesundheit & Prävention',
    facetten: [
      { slug: 'gesundheit_praevention_gesundheitsfoerderung', label: 'Gesundheitsförderung' },
      { slug: 'gesundheit_praevention_psychische_gesundheit', label: 'Psychische Gesundheit' },
      { slug: 'gesundheit_praevention_suchtpraevention', label: 'Suchtprävention' },
      { slug: 'gesundheit_praevention_palliative_care', label: 'Palliative Care' },
      { slug: 'gesundheit_praevention_medizinische_forschung', label: 'Medizinische Forschung' },
    ],
  },
  {
    key: 'kinder_jugend_familie',
    label: 'Kinder, Jugend & Familie',
    facetten: [
      { slug: 'kinder_jugend_familie_kinderschutz', label: 'Kinderschutz' },
      { slug: 'kinder_jugend_familie_jugendarbeit', label: 'Jugendarbeit' },
      { slug: 'kinder_jugend_familie_familienunterstuetzung', label: 'Familienunterstützung' },
      { slug: 'kinder_jugend_familie_fruehfoerderung', label: 'Frühförderung' },
      { slug: 'kinder_jugend_familie_ausserschulische_bildung', label: 'Ausserschulische Bildung' },
    ],
  },
  {
    key: 'recht_opferhilfe',
    label: 'Recht & Opferhilfe',
    facetten: [
      { slug: 'recht_opferhilfe_opferschutz', label: 'Opferschutz' },
      { slug: 'recht_opferhilfe_gewaltpraevention', label: 'Gewaltprävention' },
      { slug: 'recht_opferhilfe_rechtsschutz_beratung', label: 'Rechtsschutz & Beratung' },
      { slug: 'recht_opferhilfe_haeusliche_gewalt', label: 'Häusliche Gewalt' },
      { slug: 'recht_opferhilfe_digitale_gewalt', label: 'Digitale Gewalt' },
    ],
  },
  {
    key: 'entwicklung_humanitaeres',
    label: 'Entwicklung & Humanitäres',
    facetten: [
      { slug: 'entwicklung_humanitaeres_entwicklungszusammenarbeit', label: 'Entwicklungszusammenarbeit' },
      { slug: 'entwicklung_humanitaeres_humanitaere_hilfe', label: 'Humanitäre Hilfe' },
      { slug: 'entwicklung_humanitaeres_katastrophenhilfe', label: 'Katastrophenhilfe' },
    ],
  },
]

/** Flache Whitelist aller gültigen Themen-Slugs (Schutz gegen beliebige Spaltennamen im Filter). */
export const ALLE_THEMEN_SLUGS: readonly string[] = THEMEN_GRUPPEN.flatMap((g) => g.facetten.map((f) => f.slug))

const LABEL_BY_SLUG: Record<string, string> = Object.fromEntries(
  THEMEN_GRUPPEN.flatMap((g) => g.facetten.map((f) => [f.slug, f.label]))
)

/** Menschlicher Label für einen Themen-Slug (Fallback: der Slug selbst). */
export function themenLabel(slug: string): string {
  return LABEL_BY_SLUG[slug] ?? slug
}
