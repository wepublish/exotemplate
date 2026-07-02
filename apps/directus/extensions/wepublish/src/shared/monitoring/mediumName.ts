/**
 * Derives a valid medium identifier (`^[a-z][a-z0-9]*$`) from a free-form client
 * name. The auto-derived value contains only lowercase letters and digits — no
 * separators. It must start with a letter because the value ends up in a domain
 * name, where a leading digit isn't allowed; digits are fine everywhere else.
 * Hyphens are permitted in the field but only when a human types them; we never
 * insert them automatically. Used to auto-generate a best-effort `medium_name`
 * for existing clients that predate the field — the value is then admin-editable,
 * since a generated slug may not match the real identifier in the
 * infrastructure-configurator.
 */
export function slugifyMediumName(name: string): string {
  const base = (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (ü → u)
    .replace(/[^a-z0-9]+/g, '') // drop everything that isn't a letter or digit

  if (base === '') return ''
  // A domain label can't start with a digit → prefix a letter when it does.
  return /^[a-z]/.test(base) ? base : `m${base}`
}
