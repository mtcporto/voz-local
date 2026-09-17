import test from 'node:test';
import assert from 'node:assert/strict';
import { SupertonicTTSEngine } from '../src/supertonic-engine.js';
import { splitText, cleanText, normalizeBrazilianText, modelText } from '../src/text.js';
import { cachedFetch, hasCachedModels, MODEL_FILES } from '../src/assets.js';
import { toWav } from '../src/wav.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 30; i++) { if (check()) return; await tick(); } assert.fail('Condition not reached'); }

function harness() {
  const workers = [];
  const sources = [];
  let active = 0;
  let peak = 0;
  const context = {
    currentTime: 0, resume: async () => {}, close: async () => {},
    createBuffer: (_, length, rate) => ({ duration: length / rate, copyToChannel() {} }),
    createBufferSource() {
      const source = {
        connect() {}, disconnect() {},
        start(time) { this.time = time; active++; peak = Math.max(peak, active); this.started = true; },
        stop() { if (this.started) { active--; this.started = false; } },
        end() { context.currentTime = this.time + this.buffer.duration; this.stop(); this.onended?.(); },
      };
      sources.push(source);
      return source;
    },
  };
  const engine = new SupertonicTTSEngine({
    contextFactory: () => context,
    workerFactory: () => {
      const worker = {
        requests: [], terminated: false,
        postMessage(message) {
          this.requests.push(message);
          if (message.type === 'prepare') queueMicrotask(() => this.reply(message, { backend: 'wasm', modelMs: 1, voiceMs: 1 }));
        },
        reply(message, result) { this.onmessage({ data: { id: message.id, result } }); },
        finishNext() { const message = this.requests.find(r => r.type === 'infer' && !r.done); assert.ok(message); message.done = true; this.reply(message, { samples: new Float32Array(100), sampleRate: 100, generationMs: 10 }); },
        terminate() { this.terminated = true; },
      };
      workers.push(worker);
      return worker;
    },
  });
  return { engine, workers, sources, get peak() { return peak; } };
}

test('paragraphs and ordered/unordered list items retain order and boundaries', () => {
  const chunks = splitText('Primeiro parágrafo.\n\nSegundo parágrafo.\n\n1. Comprar pão\n2. Fazer café\n\n* Ler livro\n- Sair');
  assert.deepEqual(chunks.map(c => c.text), ['Primeiro parágrafo.', 'Segundo parágrafo.', 'Comprar pão', 'Fazer café', 'Ler livro', 'Sair']);
  assert.equal(chunks[0].pauseAfter, 0.18);
  assert.equal(chunks[2].pauseAfter, 0.13);
  assert.equal(chunks.at(-1).pauseAfter, 0);
});

test('short Einstein quotation stays in a single chunk without an inserted pause', () => {
  const input = 'Certa vez, Albert Einstein disse: “A imaginação é mais importante que o conhecimento. Pois o conhecimento é limitado, mas a imaginação é infinita.”';
  assert.ok(input.length > 140 && input.length <= 240);
  assert.deepEqual(splitText(input), [{ text: cleanText(input), pauseAfter: 0 }]);
});

test('short text threshold preserves hard bounds for longer text', () => {
  assert.equal(splitText('a'.repeat(240)).length, 1);
  const chunks = splitText('a'.repeat(241));
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].text.length <= 140);
  assert.equal(chunks.map(c => c.text).join(''), 'a'.repeat(241));
});

test('long text is bounded without losing words or unbroken strings', () => {
  for (const input of ['texto '.repeat(8500).trim(), 'a'.repeat(1500)]) {
    const chunks = splitText(input);
    assert.ok(chunks[0].text.length <= 140);
    assert.ok(chunks.every(c => c.text.length <= 240));
    assert.equal(chunks.map(c => c.text).join('').replaceAll(' ', ''), input.replaceAll(' ', ''));
  }
});

test('Brazilian formats, accent marks and language tags', () => {
  assert.equal(normalizeBrazilianText('R$ 12,50 em 17/09/2026 às 08h30: 10%.'), '12 reais e 50 centavos em 17 de setembro de 2026 às 8 horas e 30 minutos: 10 por cento.');
  assert.equal(normalizeBrazilianText('31/02/2026'), '31/02/2026');
  assert.equal(modelText('café', 'pt').normalize('NFC'), '<pt>café.</pt>');
  assert.equal(modelText('Olá!', 'na'), '<na>Olá!</na>');
  assert.throws(() => modelText('Olá', 'pt-BR'));
});

test('completion waits for final audio; only one source plays and one chunk is ahead', async () => {
  const h = harness();
  let finished = false;
  const reading = h.engine.speak('Primeiro.\n\nSegundo.\n\nTerceiro.').then(m => { finished = true; return m; });
  await until(() => h.workers[0]?.requests.some(r => r.type === 'infer'));
  h.workers[0].finishNext();
  await until(() => h.sources.length === 1);
  h.workers[0].finishNext();
  await tick();
  assert.equal(finished, false);
  assert.equal(h.workers[0].requests.filter(r => r.type === 'infer').length, 2);
  h.sources[0].end();
  await until(() => h.sources.length === 2);
  h.workers[0].finishNext();
  h.sources[1].end();
  await until(() => h.sources.length === 3);
  assert.equal(finished, false);
  h.sources[2].end();
  const metrics = await reading;
  assert.equal(metrics.completedChunks, 3);
  assert.equal(metrics.state, 'completed');
  assert.ok(Math.abs(metrics.chunks[1].gapMs - 180) < 0.001);
  assert.equal(h.peak, 1);
});

test('Stop while synthesizing terminates worker; replay ignores old replies', async () => {
  const h = harness();
  const first = h.engine.speak('Primeiro.');
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await until(() => h.workers[0]?.requests.some(r => r.type === 'infer'));
  h.engine.stop();
  await rejected;
  assert.ok(h.workers[0].terminated);
  const second = h.engine.speak('Segundo.');
  await until(() => h.workers[1]?.requests.some(r => r.type === 'infer'));
  h.workers[0].finishNext();
  assert.equal(h.sources.length, 0);
  h.workers[1].finishNext();
  await until(() => h.sources.length === 1);
  h.sources[0].end();
  await second;
});

test('Stop during playback cancels audio and prepared future audio', async () => {
  const h = harness();
  const reading = h.engine.speak('Primeiro.\n\nSegundo.');
  const rejected = assert.rejects(reading, { name: 'AbortError' });
  await until(() => h.workers[0]?.requests.some(r => r.type === 'infer'));
  h.workers[0].finishNext();
  await until(() => h.sources.length === 1);
  h.workers[0].finishNext();
  await tick();
  h.engine.stop();
  await rejected;
  assert.equal(h.sources[0].started, false);
  assert.equal(h.sources.length, 1);
});

test('failure in look-ahead stops after current audio and never reports completed', async () => {
  const h = harness();
  let lastMetrics;
  const reading = h.engine.speak('Primeiro.\n\nSegundo.', { onMetrics: m => { lastMetrics = m; } });
  const rejected = assert.rejects(reading, /inference failure/);
  await until(() => h.workers[0]?.requests.some(r => r.type === 'infer'));
  h.workers[0].finishNext();
  await until(() => h.sources.length === 1);
  const next = h.workers[0].requests.find(r => r.type === 'infer' && !r.done);
  h.workers[0].onmessage({ data: { id: next.id, error: 'inference failure' } });
  await tick();
  h.sources[0].end();
  await rejected;
  assert.equal(lastMetrics.state, 'error');
  assert.equal(h.sources.length, 1);
});

test('new voice/language/quality are forwarded without changing between paragraphs', async () => {
  const h = harness();
  const reading = h.engine.speak('Olá.\n\nAté logo.', { voice: 'F2', language: 'na', qualitySteps: 10, seed: 42 });
  await until(() => h.workers[0]?.requests.some(r => r.type === 'infer'));
  h.workers[0].finishNext();
  await until(() => h.sources.length === 1);
  h.workers[0].finishNext();
  h.sources[0].end();
  await until(() => h.sources.length === 2);
  h.sources[1].end();
  await reading;
  for (const r of h.workers[0].requests.filter(r => r.type === 'infer')) {
    assert.equal(r.payload.voice, 'F2');
    assert.equal(r.payload.language, 'na');
    assert.equal(r.payload.steps, 10);
  }
});

test('cache quota error does not download twice; partial model cache is not complete', async t => {
  let downloads = 0;
  t.mock.method(globalThis, 'fetch', async () => { downloads++; return new Response('data'); });
  const original = globalThis.caches;
  globalThis.caches = { open: async () => ({ match: async url => url.includes('vector_estimator') ? new Response('cached') : undefined, put: async () => { throw new Error('Quota exceeded'); } }) };
  try {
    const events = [];
    const response = await cachedFetch('https://example.com/voice.json', event => events.push(event), 'voice');
    assert.equal(await response.text(), 'data');
    assert.equal(downloads, 1);
    assert.ok(events.some(e => e.type === 'cache-warning'));
    assert.equal(await hasCachedModels(), false);
    assert.equal(MODEL_FILES.length, 6);
  } finally { if (original === undefined) delete globalThis.caches; else globalThis.caches = original; }
});

test('network failure identifies the asset and suggests checking connectivity and CORS', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(cachedFetch('https://example.com/missing.onnx', () => {}, 'modelo de voz'), error => {
    assert.match(error.message, /modelo de voz/);
    assert.match(error.message, /conexão.*CORS/);
    assert.equal(error.cause.message, 'Failed to fetch');
    return true;
  });
});

test('comparison generates a valid WAV without starting playback', async () => {
  const h = harness();
  const rendered = h.engine.renderSample('Bom dia!', { language: 'na', qualitySteps: 10, seed: 20260917 });
  await until(() => h.workers[0]?.requests.some(r => r.type === 'infer'));
  const inference = h.workers[0].requests.find(r => r.type === 'infer');
  assert.equal(inference.payload.seed, 20260917);
  assert.equal(inference.payload.language, 'na');
  h.workers[0].finishNext();
  const result = await rendered;
  assert.equal(h.sources.length, 0);
  assert.equal(result.metrics.state, 'sample-ready');
  const wav = await toWav(result.samples, result.sampleRate).arrayBuffer();
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(new DataView(wav).getUint32(24, true), result.sampleRate);
  assert.equal(wav.byteLength, 44 + result.samples.length * 2);
});
