import './style.css';
import { SupertonicTTSEngine } from './supertonic-engine.js';
import { toWav } from './wav.js';

const $ = id => document.getElementById(id);
const engine = new SupertonicTTSEngine();
const key = 'voz-supertonic-preferences';
const sampleText = 'Bom dia! Hoje vamos conversar sobre o Brasil. Você prefere café com leite ou suco de laranja?';
const seconds = ms => ms == null ? '—' : `${(ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
let busy = false;
let requestId = 0;
let urls = [];

function status(text) { $('statusText').textContent = text; }
function setBusy(value) {
  busy = value;
  for (const id of ['speakButton', 'voiceSelector', 'textToRead', 'rate', 'quality', 'language', 'compareButton']) $(id).disabled = value;
  $('stopButton').disabled = !value;
  $('statusIndicator').classList.toggle('active', value);
}
function pauseSamples() { document.querySelectorAll('#samples audio').forEach(audio => audio.pause()); }
function stats() { $('textStats').textContent = `${$('textToRead').value.length.toLocaleString('pt-BR')} caracteres`; }
function labels() { $('rateValue').textContent = `${Number($('rate').value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}×`; }
function preferences() { return { voice: $('voiceSelector').value, speed: Number($('rate').value), qualitySteps: Number($('quality').value), language: $('language').value }; }
function save() {
  try { localStorage.setItem(key, JSON.stringify({ ...preferences(), rate: $('rate').value, quality: $('quality').value })); } catch { /* Storage is optional. */ }
}
function metrics(data) {
  $('modelTime').textContent = seconds(data.modelMs);
  $('voiceTime').textContent = seconds(data.voiceMs);
  $('firstAudioTime').textContent = seconds(data.firstAudioMs);
  const gaps = data.chunks.map(c => c.gapMs).filter(n => n != null);
  $('gapTime').textContent = gaps.length ? seconds(Math.max(...gaps)) : '—';
  $('engineBadge').textContent = data.backend === 'webgpu' ? 'WebGPU ativo' : data.backend === 'wasm' ? 'WASM / CPU ativo' : 'Preparando motor';
  $('cacheInfo').textContent = `${data.cacheHits} arquivos do cache · ${data.downloads} baixados nesta leitura${data.cacheWarning ? ` · ${data.cacheWarning}` : ''}`;
  $('progressBar').style.width = `${data.chunkCount ? data.completedChunks / data.chunkCount * 100 : 0}%`;
  $('metricsDetails').textContent = JSON.stringify(data, null, 2);
}

function options(id, extra = {}) {
  return { ...preferences(), ...extra, onStatus: text => { if (id === requestId) status(text); }, onMetrics: data => { if (id === requestId) metrics(data); } };
}

async function speak() {
  if (busy) return;
  if (!$('textToRead').value.trim()) { status('Digite ou cole um texto para começar.'); $('textToRead').focus(); return; }
  const id = ++requestId;
  pauseSamples();
  setBusy(true);
  status('Preparando a leitura…');
  try { await engine.speak($('textToRead').value, options(id)); }
  catch (error) { if (id === requestId) status(error.name === 'AbortError' ? 'Leitura interrompida.' : `Falha no TTS: ${error.message}`); }
  finally { if (id === requestId) setBusy(false); }
}

function stop() {
  engine.stop();
  requestId++;
  pauseSamples();
  setBusy(false);
  status('Leitura interrompida.');
}

function clearSamples() {
  pauseSamples();
  $('samples').replaceChildren();
  urls.forEach(url => URL.revokeObjectURL(url));
  urls = [];
}

async function compare() {
  if (busy) return;
  const id = ++requestId;
  clearSamples();
  setBusy(true);
  const base = preferences();
  try {
    for (const [language, qualitySteps] of [['pt', 5], ['na', 5], ['pt', 10], ['na', 10]]) {
      if (id !== requestId) return;
      const audio = await engine.renderSample(sampleText, options(id, { ...base, language, qualitySteps, seed: 20260917 }));
      if (id !== requestId) return;
      const url = URL.createObjectURL(toWav(audio.samples, audio.sampleRate));
      urls.push(url);
      const card = document.createElement('article');
      const title = document.createElement('h3');
      title.textContent = `${base.voice} · ${language === 'pt' ? 'Português' : 'Automático'} · ${qualitySteps} passos`;
      const info = document.createElement('p');
      info.textContent = `Geração: ${seconds(audio.generationMs)} · áudio: ${seconds(audio.samples.length / audio.sampleRate * 1000)} · ${base.speed}×`;
      const player = document.createElement('audio');
      player.controls = true;
      player.src = url;
      player.setAttribute('aria-label', title.textContent);
      player.addEventListener('play', () => {
        if (busy) { player.pause(); return; }
        document.querySelectorAll('#samples audio').forEach(other => { if (other !== player) other.pause(); });
      });
      const choose = document.createElement('button');
      choose.textContent = 'Usar esta configuração';
      choose.addEventListener('click', () => {
        if (busy) return;
        $('voiceSelector').value = base.voice;
        $('rate').value = base.speed;
        $('language').value = language;
        $('quality').value = qualitySteps;
        labels(); save(); status('Configuração selecionada.');
      });
      card.append(title, info, player, choose);
      $('samples').append(card);
    }
    status('Quatro amostras prontas. Ouça uma de cada vez e escolha sua preferência.');
  } catch (error) { if (id === requestId) status(`Comparação interrompida: ${error.message}`); }
  finally { if (id === requestId) setBusy(false); }
}

for (const voice of engine.getVoices()) $('voiceSelector').add(new Option(`${voice.label} (${voice.id})`, voice.id));
try {
  const saved = JSON.parse(localStorage.getItem(key) || '{}');
  if (engine.getVoices().some(v => v.id === saved.voice)) $('voiceSelector').value = saved.voice;
  const rate = Number(saved.speed ?? saved.rate);
  if (rate >= 0.9 && rate <= 1.5) $('rate').value = rate;
  const quality = Number(saved.qualitySteps ?? saved.quality);
  if ([5, 10].includes(quality)) $('quality').value = quality;
  if (['pt', 'na'].includes(saved.language)) $('language').value = saved.language;
} catch { /* Ignore invalid preferences. */ }
$('speakButton').addEventListener('click', speak);
$('stopButton').addEventListener('click', stop);
$('compareButton').addEventListener('click', compare);
$('textToRead').addEventListener('input', stats);
for (const id of ['rate', 'quality', 'language', 'voiceSelector']) $(id).addEventListener('change', () => { labels(); save(); });
$('rate').addEventListener('input', labels);
$('sampleText').textContent = sampleText;
stats(); labels();
const startupId = requestId;
void engine.hasCachedModels().then(cached => {
  if (requestId === startupId && !busy) status(cached ? 'Modelos em cache. Serão carregados localmente ao iniciar.' : 'Pronto. Arquivos que faltarem serão baixados na primeira leitura.');
});
window.addEventListener('beforeunload', () => { engine.dispose(); clearSamples(); });
