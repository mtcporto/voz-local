import { cachedFetch, modelUrl, voiceUrl } from './assets.js';
import { modelText, seededRandom } from './text.js';

let ort;
let sessions;
let cfg;
let indexer;
let backend;
const styles = new Map();
const now = () => performance.now();
const dispose = result => Object.values(result || {}).forEach(t => t.dispose());

async function configure(provider) {
  // Both backends run inside this dedicated worker, without ORT's proxy.
  if (provider === 'webgpu') {
    ort = await import('onnxruntime-web/webgpu');
    ort.env.wasm.wasmPaths = {
      wasm: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
      mjs: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
    };
  } else {
    ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.wasmPaths = {
      wasm: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url).href,
      mjs: new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', import.meta.url).href,
    };
  }
  ort.env.wasm.proxy = false;
  // Nested pthread workers stalled during browser verification. Use the
  // verified single-thread CPU path; UI responsiveness comes from our worker.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.initTimeout = 15000;
}

async function initialize(report) {
  if (sessions) return { backend, modelMs: 0, threads: ort.env.wasm.numThreads };
  const start = now();
  cfg = await (await cachedFetch(modelUrl('tts.json'), report, 'configuração')).json();
  indexer = await (await cachedFetch(modelUrl('unicode_indexer.json'), report, 'indexador')).json();
  const load = async provider => {
    await configure(provider);
    const loaded = {};
    try {
      for (const [key, file] of [['dp', 'duration_predictor'], ['enc', 'text_encoder'], ['vec', 'vector_estimator'], ['voc', 'vocoder']]) {
        const bytes = await (await cachedFetch(modelUrl(`${file}.onnx`), report, file)).arrayBuffer();
        report({ type: 'status', message: `Carregando ${file} (${provider})…` });
        loaded[key] = await ort.InferenceSession.create(bytes, { executionProviders: [provider], graphOptimizationLevel: 'all' });
      }
      sessions = loaded;
      backend = provider;
    } catch (error) {
      await Promise.allSettled(Object.values(loaded).map(s => s.release()));
      throw error;
    }
  };
  try {
    if (!await navigator.gpu?.requestAdapter()) throw new Error('Nenhum adaptador WebGPU disponível.');
    await load('webgpu');
  } catch (error) {
    report({ type: 'fallback', message: error.message });
    await load('wasm');
  }
  return { backend, modelMs: now() - start, threads: ort.env.wasm.numThreads };
}

async function loadStyle(voice, report) {
  const start = now();
  if (!styles.has(voice)) {
    const json = await (await cachedFetch(voiceUrl(voice), report, `voz ${voice}`)).json();
    styles.set(voice, {
      ttl: new ort.Tensor('float32', Float32Array.from(json.style_ttl.data.flat(Infinity)), json.style_ttl.dims),
      dp: new ort.Tensor('float32', Float32Array.from(json.style_dp.data.flat(Infinity)), json.style_dp.dims),
    });
  }
  return { voiceMs: now() - start };
}

async function infer({ text, voice, speed, steps, language, seed }) {
  if (!sessions || !styles.has(voice)) throw new Error('Motor ainda não preparado.');
  const start = now();
  const style = styles.get(voice);
  const ids = Array.from(modelText(text, language), c => indexer[c.codePointAt(0)] ?? -1);
  const textIds = new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
  const mask = new ort.Tensor('float32', new Float32Array(ids.length).fill(1), [1, 1, ids.length]);
  let encoded;
  let latentMask;
  let total;
  try {
    const prediction = await sessions.dp.run({ text_ids: textIds, style_dp: style.dp, text_mask: mask });
    const duration = Number(prediction.duration.data[0]) / speed;
    dispose(prediction);
    // Reject broken duration predictions before allocating a huge latent.
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new Error('Duração inesperada. Tente um trecho menor.');
    encoded = await sessions.enc.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: mask });
    const size = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
    const length = Math.ceil(duration * cfg.ae.sample_rate / size);
    const dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
    let latent = new Float32Array(dim * length);
    const random = seededRandom(seed);
    for (let i = 0; i < latent.length; i++) latent[i] = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
    latentMask = new ort.Tensor('float32', new Float32Array(length).fill(1), [1, 1, length]);
    total = new ort.Tensor('float32', [steps], [1]);
    for (let step = 0; step < steps; step++) {
      const noisy = new ort.Tensor('float32', latent, [1, dim, length]);
      const current = new ort.Tensor('float32', [step], [1]);
      let result;
      try {
        result = await sessions.vec.run({ noisy_latent: noisy, text_emb: encoded.text_emb, style_ttl: style.ttl, latent_mask: latentMask, text_mask: mask, current_step: current, total_step: total });
        latent = Float32Array.from(result.denoised_latent.data);
      } finally { dispose(result); noisy.dispose(); current.dispose(); }
    }
    const tensor = new ort.Tensor('float32', latent, [1, dim, length]);
    let audio;
    try {
      audio = await sessions.voc.run({ latent: tensor });
      const samples = Float32Array.from(audio.wav_tts.data.subarray(0, Math.floor(duration * cfg.ae.sample_rate)));
      return { samples, sampleRate: cfg.ae.sample_rate, generationMs: now() - start };
    } finally { dispose(audio); tensor.dispose(); }
  } finally { textIds.dispose(); mask.dispose(); dispose(encoded); latentMask?.dispose(); total?.dispose(); }
}

// The controller allows one inference at a time and terminates this worker
// on cancellation while busy. No stale computation can enter a new reading.
let chain = Promise.resolve();
self.onmessage = ({ data: { id, type, payload } }) => {
  chain = chain.then(async () => {
    const report = event => self.postMessage({ id, event });
    try {
      let result;
      if (type === 'prepare') result = { ...await initialize(report), ...await loadStyle(payload.voice, report) };
      else if (type === 'infer') result = await infer(payload);
      else throw new Error('Operação desconhecida.');
      self.postMessage({ id, result }, result.samples ? [result.samples.buffer] : []);
    } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
  });
};
