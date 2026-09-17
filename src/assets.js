export const R2_URL = 'https://pub-31aa7676faf240eeb9ed94b6cb715529.r2.dev';
export const CACHE = 'voz-supertonic-3-v1';
export const MODEL_FILES = ['tts.json', 'unicode_indexer.json', 'duration_predictor.onnx', 'text_encoder.onnx', 'vector_estimator.onnx', 'vocoder.onnx'];
export const VOICES = [['F1', 'Sarah'], ['F2', 'Lily'], ['F3', 'Jessica'], ['F4', 'Olivia'], ['F5', 'Emily'], ['M1', 'Alex'], ['M2', 'James'], ['M3', 'Robert'], ['M4', 'Sam'], ['M5', 'Daniel']];
export const modelUrl = file => `${R2_URL}/onnx/${file}`;
export const voiceUrl = voice => `${R2_URL}/voice_styles/${voice}.json?download=true`;

export async function hasCachedModels() {
  try {
    const cache = await caches.open(CACHE);
    return (await Promise.all(MODEL_FILES.map(file => cache.match(modelUrl(file))))).every(Boolean);
  } catch { return false; }
}

export async function cachedFetch(url, report, label) {
  let cache;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) { report({ type: 'asset', source: 'cache', label }); return hit; }
  } catch { /* Downloads still work when storage is unavailable. */ }
  report({ type: 'status', message: `Baixando ${label}…` });
  let response;
  try { response = await fetch(url); }
  catch (cause) {
    throw new Error(`Não foi possível baixar ${label}. Verifique a conexão e se o CORS do bucket permite o endereço deste site.`, { cause });
  }
  if (!response.ok) throw new Error(`Falha ao baixar ${label} (${response.status}).`);
  if (cache) {
    try { await cache.put(url, response.clone()); }
    catch { report({ type: 'cache-warning', message: 'Não foi possível guardar todos os arquivos no cache deste navegador.' }); }
  }
  report({ type: 'asset', source: 'network', label });
  return response;
}
