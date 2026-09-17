import { VOICES, hasCachedModels } from './assets.js';
import { splitText } from './text.js';

const abortError = () => new DOMException('Leitura interrompida.', 'AbortError');
const clock = () => performance.now();

export class SupertonicTTSEngine {
  constructor({ workerFactory, contextFactory } = {}) {
    this.workerFactory = workerFactory || (() => new Worker(new URL('./synthesis-worker.js', import.meta.url), { type: 'module' }));
    this.contextFactory = contextFactory || (() => new AudioContext());
    this.worker = null;
    this.context = null;
    this.source = null;
    this.pending = new Map();
    this.sequence = 0;
    this.run = null;
    this.backend = null;
  }
  getVoices() { return VOICES.map(([id, label]) => ({ id, label })); }
  getBackend() { return this.backend; }
  hasCachedModels() { return hasCachedModels(); }

  ensureWorker() {
    if (this.worker) return;
    const worker = this.workerFactory();
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      const task = this.pending.get(data.id);
      if (!task) return;
      if (data.event) { task.report(data.event); return; }
      this.pending.delete(data.id);
      if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
    };
    worker.onerror = event => { if (this.worker === worker) this.resetWorker(new Error(event.message || 'Falha no motor neural.')); };
    worker.onmessageerror = () => { if (this.worker === worker) this.resetWorker(new Error('Falha na comunicação com o motor.')); };
  }

  resetWorker(error = abortError()) {
    this.worker?.terminate();
    this.worker = null;
    this.backend = null;
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
  }

  request(type, payload, run) {
    this.check(run);
    this.ensureWorker();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, report: event => {
        if (this.run !== run) return;
        if (event.type === 'asset') run.metrics[event.source === 'cache' ? 'cacheHits' : 'downloads']++;
        if (event.type === 'fallback') run.metrics.fallbackReason = event.message;
        if (event.type === 'cache-warning') run.metrics.cacheWarning = event.message;
        if (event.type === 'status' && !this.source) run.options.onStatus?.(event.message);
        this.publish(run);
      } });
      try { this.worker.postMessage({ id, type, payload }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  check(run) { if (this.run !== run || run.abort.signal.aborted) throw abortError(); }
  publish(run) {
    if (this.run === run) run.options.onMetrics?.(structuredClone(run.metrics));
  }

  begin(options, count) {
    this.stop();
    const voice = options.voice ?? 'F1';
    const language = options.language ?? 'pt';
    const speed = Number(options.speed ?? 1.05);
    const steps = Number(options.qualitySteps ?? 5);
    if (!VOICES.some(([id]) => id === voice) || !['pt', 'na'].includes(language) || ![5, 10].includes(steps) || !Number.isFinite(speed) || speed < 0.9 || speed > 1.5) throw new Error('Configuração de voz inválida.');
    const run = {
      options, voice, language, speed, steps, seed: options.seed ?? crypto.getRandomValues(new Uint32Array(1))[0],
      abort: new AbortController(), start: clock(),
      metrics: { voice, language, steps, speed, backend: null, modelMs: null, voiceMs: null, firstAudioMs: null, totalMs: null, cacheHits: 0, downloads: 0, completedChunks: 0, chunkCount: count, chunks: [], state: 'preparing' },
    };
    this.run = run;
    this.publish(run);
    return run;
  }

  async prepare(run) {
    run.options.onStatus?.('Preparando o motor e a voz…');
    const ready = await this.request('prepare', { voice: run.voice }, run);
    this.check(run);
    this.backend = ready.backend;
    Object.assign(run.metrics, ready);
    this.publish(run);
  }

  async synthesize(chunk, index, run) {
    this.check(run);
    if (!this.source) {
      run.metrics.state = 'generating';
      run.options.onStatus?.(`Gerando trecho ${index + 1} de ${run.metrics.chunkCount}…`);
      this.publish(run);
    }
    const result = await this.request('infer', { text: chunk.text, voice: run.voice, language: run.language, speed: run.speed, steps: run.steps, seed: (run.seed + index) >>> 0 }, run);
    this.check(run);
    run.metrics.chunks[index] = { index: index + 1, characters: chunk.text.length, generationMs: result.generationMs, audioMs: result.samples.length / result.sampleRate * 1000, gapMs: null, extraWaitMs: null };
    this.publish(run);
    return result;
  }

  async speak(text, options = {}) {
    if (text.length > 50000) throw new Error('O limite é 50.000 caracteres.');
    const chunks = splitText(text);
    if (!chunks.length) throw new Error('Digite um texto para leitura.');
    const run = this.begin(options, chunks.length);
    this.context ??= this.contextFactory();
    try {
      await this.context.resume();
      await this.prepare(run);
      let next = this.synthesize(chunks[0], 0, run).then(value => ({ value }), error => ({ error }));
      let previousEnd = null;
      for (let i = 0; i < chunks.length; i++) {
        const result = await next;
        if (result.error) throw result.error;
        this.check(run);
        // At most one future chunk. Rejections are observed even after Stop.
        if (i + 1 < chunks.length) next = this.synthesize(chunks[i + 1], i + 1, run).then(value => ({ value }), error => ({ error }));
        previousEnd = await this.play(result.value, i, previousEnd, i ? chunks[i - 1].pauseAfter : 0, run);
        this.check(run);
        run.metrics.completedChunks = i + 1;
        if (i + 1 < chunks.length && this.pending.size) {
          run.metrics.state = 'generating';
          options.onStatus?.(`Preparando o próximo trecho (${i + 2} de ${chunks.length})…`);
        }
        this.publish(run);
      }
      run.metrics.state = 'completed';
      run.metrics.totalMs = clock() - run.start;
      this.publish(run);
      options.onStatus?.('Leitura concluída.');
      return structuredClone(run.metrics);
    } catch (error) {
      if (this.run === run) this.endFailed(run, error);
      throw error;
    } finally { if (this.run === run) this.run = null; }
  }

  play(audio, index, previousEnd, pause, run) {
    this.check(run);
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.copyToChannel(audio.samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, previousEnd === null ? ctx.currentTime : previousEnd + pause);
    const endAt = startAt + buffer.duration;
    const metric = run.metrics.chunks[index];
    if (index === 0) run.metrics.firstAudioMs = clock() - run.start + (startAt - ctx.currentTime) * 1000;
    else {
      metric.gapMs = (startAt - previousEnd) * 1000;
      metric.extraWaitMs = Math.max(0, metric.gapMs - pause * 1000);
    }
    run.metrics.state = 'playing';
    this.source = source;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        source.onended = null;
        source.disconnect();
        run.abort.signal.removeEventListener('abort', cancel);
        if (this.source === source) this.source = null;
      };
      const cancel = () => { try { source.stop(); } catch {} cleanup(); reject(abortError()); };
      run.abort.signal.addEventListener('abort', cancel, { once: true });
      source.onended = () => { cleanup(); resolve(endAt); };
      try {
        source.start(startAt);
        run.options.onStatus?.(`Reproduzindo trecho ${index + 1} de ${run.metrics.chunkCount}…`);
        this.publish(run);
      } catch (error) { cleanup(); reject(error); }
    });
  }

  async renderSample(text, options = {}) {
    const chunks = splitText(text);
    if (chunks.length !== 1) throw new Error('Use uma amostra curta para comparar as vozes.');
    const run = this.begin(options, 1);
    try {
      await this.prepare(run);
      const audio = await this.synthesize(chunks[0], 0, run);
      run.metrics.totalMs = clock() - run.start;
      run.metrics.state = 'sample-ready';
      this.publish(run);
      return { ...audio, metrics: structuredClone(run.metrics) };
    } catch (error) { if (this.run === run) this.endFailed(run, error); throw error; }
    finally { if (this.run === run) this.run = null; }
  }

  endFailed(run, error) {
    run.metrics.state = error.name === 'AbortError' ? 'stopped' : 'error';
    run.metrics.totalMs = clock() - run.start;
    this.publish(run);
    run.abort.abort();
    if (this.pending.size) this.resetWorker();
  }

  stop() {
    const run = this.run;
    if (!run) return;
    this.endFailed(run, abortError());
    this.run = null;
  }

  dispose() { this.stop(); this.resetWorker(); void this.context?.close(); this.context = null; }
}
