import { Injectable, signal } from '@angular/core';
import {
  DEFAULT_MODEL_CONFIG,
  HybridModelConfig,
  ProviderStatus,
} from '../models/model-config.models';
import { TauriBridgeService } from './tauri-bridge.service';

@Injectable({
  providedIn: 'root',
})
export class ModelConfigService {
  readonly config = signal<HybridModelConfig>(DEFAULT_MODEL_CONFIG);
  readonly status = signal<ProviderStatus>({
    mode: DEFAULT_MODEL_CONFIG.mode,
    configured: false,
    message: 'Not configured',
  });

  constructor(private readonly tauriBridge: TauriBridgeService) {}

  async loadConfig(): Promise<void> {
    if (!this.tauriBridge.isTauriRuntime()) {
      this.refreshStatusFromLocalState();
      return;
    }

    const config = await this.tauriBridge.invoke<HybridModelConfig>('get_model_config');
    this.config.set(config);
    await this.refreshStatus();
  }

  async saveConfig(config: HybridModelConfig): Promise<void> {
    if (!this.tauriBridge.isTauriRuntime()) {
      this.config.set(config);
      this.refreshStatusFromLocalState();
      return;
    }

    const saved = await this.tauriBridge.invoke<HybridModelConfig>('save_model_config', { config });
    this.config.set(saved);
    await this.refreshStatus();
  }

  async refreshStatus(): Promise<void> {
    if (!this.tauriBridge.isTauriRuntime()) {
      this.refreshStatusFromLocalState();
      return;
    }
    const status = await this.tauriBridge.invoke<ProviderStatus>('get_model_provider_status');
    this.status.set(status);
  }

  private refreshStatusFromLocalState(): void {
    const config = this.config();
    const gemmaReady =
      config.gemma.endpoint.trim().length > 0 &&
      config.gemma.model.trim().length > 0 &&
      config.gemma.modelFileName.trim().length > 0 &&
      config.gemma.runtimeFileName.trim().length > 0;
    const cloudReady =
      config.cloud.apiKey.trim().length > 0 &&
      config.cloud.model.trim().length > 0 &&
      config.cloud.apiBaseUrl.trim().length > 0;
    const localReady =
      config.local.endpoint.trim().length > 0 && config.local.model.trim().length > 0;

    const configured =
      config.mode === 'bundled-gemma'
        ? gemmaReady
        : config.mode === 'cloud'
          ? cloudReady
          : localReady;
    const message =
      config.mode === 'bundled-gemma'
        ? gemmaReady
          ? `Bundled Gemma configured (${config.gemma.model})`
          : 'Bundled Gemma is missing runtime or model metadata'
        : config.mode === 'cloud'
          ? cloudReady
            ? `Cloud provider ready (${config.cloud.model})`
            : 'Cloud provider missing API key or model'
          : localReady
            ? `Local provider ready (${config.local.model})`
            : 'Local provider missing endpoint or model';

    this.status.set({
      mode: config.mode,
      configured,
      message,
    });
  }
}
