export interface CloudModelConfig {
  provider: 'openai-compatible';
  apiBaseUrl: string;
  model: string;
  apiKey: string;
}

export interface ProviderStatus {
  configured: boolean;
  message: string;
}
