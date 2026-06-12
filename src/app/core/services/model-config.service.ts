import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { CloudModelConfig, ProviderStatus } from '../models/model-config.models';

@Injectable({
  providedIn: 'root',
})
export class ModelConfigService {
  readonly config = signal<CloudModelConfig>({
    provider: 'openai-compatible',
    apiBaseUrl: environment.cloudApiBaseUrl,
    model: environment.cloudModel,
    apiKey: environment.cloudApiKey,
  });

  readonly status = signal<ProviderStatus>(this.computeStatus());

  private computeStatus(): ProviderStatus {
    const key = (environment.cloudApiKey ?? '').trim();
    const base = (environment.cloudApiBaseUrl ?? '').trim();
    const model = (environment.cloudModel ?? '').trim();

    if (!key) {
      return { configured: false, message: 'Missing API key' };
    }
    if (!base) {
      return { configured: false, message: 'Missing API base URL' };
    }
    return { configured: true, message: `Cloud ready: ${model}` };
  }
}
