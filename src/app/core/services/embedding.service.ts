import { Injectable, signal } from '@angular/core';
import { pipeline, env } from '@xenova/transformers';

@Injectable({
  providedIn: 'root',
})
export class EmbeddingService {
  readonly isModelLoading = signal(false);
  private extractor: any = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.extractor) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.isModelLoading.set(true);
    this.initPromise = (async () => {
      try {
        // Disable searching for local files (which causes warnings in browser environments)
        env.allowLocalModels = false;
        
        // Load the feature extraction pipeline with a standard small embedding model
        this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      } catch (error) {
        console.error('Failed to load local embedding model:', error);
        this.initPromise = null;
        throw error;
      } finally {
        this.isModelLoading.set(false);
      }
    })();

    return this.initPromise;
  }

  async getEmbedding(text: string): Promise<number[]> {
    await this.init();
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  async getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    await this.init();
    const embeddings: number[][] = [];
    
    // Process texts sequentially to be safe with memory allocation
    for (const text of texts) {
      const output = await this.extractor(text, { pooling: 'mean', normalize: true });
      embeddings.push(Array.from(output.data));
    }
    
    return embeddings;
  }

  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      return 0;
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) {
      return 0;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
