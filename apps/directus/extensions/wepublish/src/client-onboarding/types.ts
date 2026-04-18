// Subset of Directus' EndpointExtensionContext that onboarding controllers
// actually need. Kept loosely typed because the SDK's own types are not
// exported in a useful form for bundle endpoints.
export interface EndpointContext {
  env: Record<string, any>
  services: any
  getSchema: () => Promise<any>
}
