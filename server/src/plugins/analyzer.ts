import fp from 'fastify-plugin';
import type { PhotoAnalyzer } from '../lib/analyzer.ts';

declare module 'fastify' {
  interface FastifyInstance {
    analyzer: PhotoAnalyzer;
  }
}

export interface AnalyzerPluginOptions {
  analyzer: PhotoAnalyzer;
}

// Shares the photo analyzer (Gemini) with every route as `app.analyzer`.
export default fp<AnalyzerPluginOptions>(
  async (app, { analyzer }) => {
    app.decorate('analyzer', analyzer);
  },
  { name: 'analyzer' },
);
