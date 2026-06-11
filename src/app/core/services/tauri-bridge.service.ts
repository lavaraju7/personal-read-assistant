import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class TauriBridgeService {
  private tauriInvoke:
    | ((command: string, args?: Record<string, unknown>) => Promise<unknown>)
    | null = null;

  constructor() {
    this.resolveInvoke();
  }

  async invoke<TResponse>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<TResponse> {
    this.resolveInvoke();
    if (!this.tauriInvoke) {
      throw new Error('Tauri runtime is not available in this environment.');
    }
    return this.tauriInvoke(command, args) as Promise<TResponse>;
  }

  isTauriRuntime(): boolean {
    this.resolveInvoke();
    return this.tauriInvoke !== null;
  }

  private resolveInvoke(): void {
    const w = window as unknown as {
      __TAURI__?: {
        core?: {
          invoke?: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
    };

    this.tauriInvoke = w.__TAURI__?.core?.invoke ?? null;
  }
}
