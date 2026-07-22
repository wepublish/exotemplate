import type { CodegenConfig } from '@graphql-codegen/cli'
const config: CodegenConfig = {
  schema: [{ [`${process.env.NEXT_PUBLIC_DIRECTUS_URL}/graphql`]: { headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_DIRECTUS_TOKEN}` } } }],
  documents: ['src/graphql/**/*.ts'],
  generates: { 'src/graphql/generated/': { preset: 'client' } },
}
export default config
