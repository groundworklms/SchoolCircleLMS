// Shared capability registry for the root Next runtime. Keep the server lane
// as the single implementation so all route surfaces require explicit model
// endpoint and model configuration.
export * from './server/providers.js';