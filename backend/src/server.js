import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { getDb } from './db/index.js';
import { JobQueue, failInterruptedJobs } from './services/jobs.js';
import { runSearch } from './services/pipeline.js';
import { apiRouter } from './routes/api.js';

export function createApp() {
  getDb();
  failInterruptedJobs();
  const queue = new JobQueue({ concurrency: config.pipeline.jobConcurrency, handler: runSearch });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url.startsWith('/api/thumbs') || req.url.endsWith('/events') } }));
  app.use('/api', apiRouter(queue));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status >= 500) req.log.error({ err }, 'request failed');
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side.' : err.message });
  });
  return { app, queue };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = createApp();
  app.listen(config.port, () => {
    logger.info({ port: config.port, mockMode: config.mockMode }, `API listening${config.mockMode ? ' (MOCK MODE: no API keys set)' : ''}`);
  });
}
