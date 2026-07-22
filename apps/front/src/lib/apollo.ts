import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client'

// Browser spricht nur mit dem eigenen Origin (/api/directus). Der server-seitige
// Proxy (src/pages/api/directus.ts) haelt den Directus-Token — er verlaesst den
// Server nie. Relative URI funktioniert clientseitig (Datenabruf laeuft im Browser).
export function makeClient() {
  return new ApolloClient({
    link: new HttpLink({ uri: '/api/directus' }),
    cache: new InMemoryCache(),
    defaultOptions: { watchQuery: { fetchPolicy: 'cache-and-network', pollInterval: 45000 } },
  })
}
