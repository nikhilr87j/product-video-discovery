/**
 * In-process job queue with bounded concurrency + per-job event streams.
 *
 * Why not BullMQ/Redis: the project must run with one command and a single
 * container; searches are long (1-4 min) but few. The interface (enqueue,
 * events, status in the DB) is the same shape a BullMQ worker would have,
 * so swapping is mechanical. Job state lives in SQLite, so a restart marks
 * interrupted jobs as failed instead of leaving them "running" forever.
 */
import { EventEmitter } from 'node:events';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';

export class JobQueue {
  constructor({ concurrency = 2, handler }) {
    this.concurrency = concurrency;
    this.handler = handler;
    this.pending = [];
    this.running = 0;
    this.streams = new Map(); // jobId -> { emitter, events[] }
  }

  stream(id) {
    if (!this.streams.has(id)) this.streams.set(id, { emitter: new EventEmitter(), events: [] });
    return this.streams.get(id);
  }

  emit(id, event) {
    const s = this.stream(id);
    const e = { ...event, at: Date.now() };
    s.events.push(e);
    s.emitter.emit('event', e);
  }

  /** Replay past events, then follow live ones. Returns an unsubscribe fn. */
  subscribe(id, fn) {
    const s = this.stream(id);
    s.events.forEach(fn);
    s.emitter.on('event', fn);
    return () => s.emitter.off('event', fn);
  }

  enqueue(id, payload) {
    this.pending.push({ id, payload });
    this.emit(id, { type: 'stage', stage: 'queued', status: 'active', message: this.running >= this.concurrency ? `Waiting for a free worker (${this.pending.length} queued)` : 'Starting' });
    this.#drain();
  }

  #drain() {
    while (this.running < this.concurrency && this.pending.length) {
      const job = this.pending.shift();
      this.running++;
      const emit = (e) => this.emit(job.id, e);
      Promise.resolve()
        .then(() => this.handler(job.id, job.payload, emit))
        .catch((err) => {
          logger.error({ err, jobId: job.id }, 'job failed');
          emit({ type: 'error', message: err.message });
        })
        .finally(() => {
          this.running--;
          emit({ type: 'end' });
          // keep the replay buffer for a while for late subscribers, then free it
          setTimeout(() => this.streams.delete(job.id), 10 * 60_000).unref();
          this.#drain();
        });
    }
  }
}

export function failInterruptedJobs() {
  const r = getDb()
    .prepare("UPDATE searches SET status = 'failed', error = 'Server restarted while this search was running' WHERE status IN ('queued', 'running')")
    .run();
  if (r.changes) logger.warn({ count: r.changes }, 'marked interrupted searches as failed');
}
