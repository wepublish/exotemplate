/**
 * Derives a valid Terraform medium identifier (`^[a-z][a-z0-9_]*$`) from a
 * free-form client name. Used to auto-generate a best-effort `medium_name` for
 * existing clients that predate the field — the value is then admin-editable,
 * since a generated slug may not match the real identifier in the
 * infrastructure-configurator.
 */
export function slugifyMediumName(name: string): string {
  const base = (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (ü → u)
    .replace(/[^a-z0-9]+/g, '_') // any run of non-alnum → single underscore
    .replace(/^_+|_+$/g, '') // trim leading/trailing underscores

  if (base === '') return ''
  // Terraform identifiers must start with a letter.
  return /^[a-z]/.test(base) ? base : `m${base}`
}
