export type ModelMode = 'bundled-gemma' | 'cloud' | 'local';

export interface BundledGemmaConfig {
  provider: 'bundled-gemma';
  model: string;
  endpoint: string;
  modelFileName: string;
  runtimeFileName: string;
}

export interface CloudModelConfig {
  provider: 'openai-compatible';
  apiBaseUrl: string;
  model: string;
  apiKey: string;
}

export interface LocalModelConfig {
  provider: 'ollama-compatible';
  endpoint: string;
  model: string;
}

export interface HybridModelConfig {
  mode: ModelMode;
  gemma: BundledGemmaConfig;
  cloud: CloudModelConfig;
  local: LocalModelConfig;
}

export interface ProviderStatus {
  mode: ModelMode;
  configured: boolean;
  message: string;
}

export const DEFAULT_MODEL_CONFIG: HybridModelConfig = {
  mode: 'bundled-gemma',
  gemma: {
    provider: 'bundled-gemma',
    endpoint: 'http://127.0.0.1:17641',
    model: 'gemma-3-1b-it-q4',
    modelFileName: 'gemma-3-1b-it-q4.gguf',
    runtimeFileName: 'gemma-server.exe',
  },
  cloud: {
    provider: 'openai-compatible',
    apiBaseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKey: '',
  },
  local: {
    provider: 'ollama-compatible',
    endpoint: 'http://127.0.0.1:11434',
    model: 'llama3.1:8b',
  },
};
