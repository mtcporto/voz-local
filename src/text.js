// pt-BR is the app locale; pt and na are trained Supertonic language tags.
const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function normalizeBrazilianText(input) {
  return input
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (original, day, month, year) => {
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      return date.getMonth() === Number(month) - 1 && date.getDate() === Number(day)
        ? `${Number(day)} de ${months[Number(month) - 1]} de ${year}` : original;
    })
    .replace(/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?(?!\d)/g, (_, integer, cents) => {
      const value = Number(integer.replaceAll('.', ''));
      return `${value} ${value === 1 ? 'real' : 'reais'}${Number(cents) ? ` e ${Number(cents)} ${Number(cents) === 1 ? 'centavo' : 'centavos'}` : ''}`;
    })
    .replace(/\b(\d{1,2})h(\d{2})\b/g, (original, h, m) => Number(h) < 24 && Number(m) < 60 ? `${Number(h)} horas${Number(m) ? ` e ${Number(m)} minutos` : ''}` : original)
    .replace(/\b(\d+(?:,\d+)?)\s*%/g, '$1 por cento')
    .replace(/\b(\d+),(\d+)\b/g, '$1 vírgula $2')
    .replace(/\bSr\.(?=\s)/g, 'senhor').replace(/\bSra\.(?=\s)/g, 'senhora')
    .replace(/\bDr\.(?=\s)/g, 'doutor').replace(/\bDra\.(?=\s)/g, 'doutora');
}

export function cleanText(input) {
  return normalizeBrazilianText(input.replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, '\nBloco de código omitido.\n')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link omitido')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^([ \t]*)\*\s+/gm, '$1- ')
    .replace(/[*_`~|]/g, ' ')
    .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019´]/g, "'")
    .replace(/[–—‑]/g, '-')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')).trim();
}

// Hard bound even for a single unpunctuated sentence or an enormous word.
function takePart(text, max) {
  if (text.length <= max) return [text, ''];
  const space = text.lastIndexOf(' ', max);
  const end = space > max / 3 ? space : max;
  return [text.slice(0, end).trim(), text.slice(end).trim()];
}

export function splitText(input, max = 240, firstMax = 140) {
  const chunks = [];
  const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'sentence' });
  const cleaned = cleanText(input);
  // A short reading already fits in one inference: don't split it merely
  // to meet the smaller first-chunk target used for longer readings.
  const firstLimit = cleaned.length <= max ? max : Math.min(firstMax, max);
  const paragraphs = cleaned.split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    for (const line of paragraph.split('\n').filter(line => line.trim())) {
      const isList = /^\s*(?:[-+•]|\d+[.)])\s+/.test(line);
      const text = line.replace(/^\s*(?:[-+•]|\d+[.)])\s+/, '').trim();
      let current = '';
      for (const { segment } of segmenter.segment(text)) {
        let remaining = segment.trim();
        while (remaining) {
          const limit = chunks.length ? max : firstLimit;
          const [part, tail] = takePart(remaining, limit);
          if (current && current.length + part.length + 1 > limit) {
            chunks.push({ text: current, pauseAfter: 0.08 });
            current = '';
            continue;
          }
          current += `${current ? ' ' : ''}${part}`;
          remaining = tail;
          if (remaining) { chunks.push({ text: current, pauseAfter: 0.08 }); current = ''; }
        }
      }
      if (current) chunks.push({ text: current, pauseAfter: isList ? 0.13 : 0.08 });
    }
    if (chunks.length) chunks.at(-1).pauseAfter = 0.18;
  }
  if (chunks.length) chunks.at(-1).pauseAfter = 0;
  return chunks;
}

export function modelText(text, language) {
  if (!['pt', 'na'].includes(language)) throw new Error('Idioma não suportado pelo modelo.');
  let normalized = text.normalize('NFKD').replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,\x22'\)\]}…]$/.test(normalized)) normalized += '.';
  return `<${language}>${normalized}</${language}>`;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + 1) / 4294967297; };
}
