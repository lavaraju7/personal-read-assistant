import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CloudModelConfig, ProviderStatus } from '../models/model-config.models';

@Injectable({
  providedIn: 'root',
})
export class ModelConfigService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly config = signal<CloudModelConfig>({
    provider: 'openai-compatible',
    apiBaseUrl: '',
    model: '',
    apiKey: '',
  });

  readonly status = signal<ProviderStatus>({
    configured: false,
    message: 'Connecting to backend...',
  });

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const configData = await firstValueFrom(
        this.http.get<CloudModelConfig>(`${this.apiUrl}/api/config`)
      );
      if (configData) {
        this.config.set(configData);
      }
      await this.refreshStatus();
    } catch (err) {
      console.error('Failed to initialize model config from backend:', err);
      this.status.set({
        configured: false,
        message: 'Could not connect to backend server',
      });
    }
  }

  async refreshStatus(): Promise<void> {
    try {
      const statusData = await firstValueFrom(
        this.http.get<ProviderStatus>(`${this.apiUrl}/api/status`)
      );
      if (statusData) {
        this.status.set(statusData);
      }
    } catch (err) {
      console.error('Failed to fetch backend status:', err);
    }
  }

  async saveConfig(newConfig: CloudModelConfig): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post<CloudModelConfig>(`${this.apiUrl}/api/config`, newConfig)
      );
      this.config.set(newConfig);
      await this.refreshStatus();
    } catch (err) {
      console.error('Failed to save config to backend:', err);
      throw err;
    }
  }
}
