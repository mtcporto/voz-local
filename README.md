# Voz Local

Leitor de texto com síntese neural no navegador usando **Supertonic 3**, da Supertone. Seu texto é processado no dispositivo, com dez vozes e tratamento de português brasileiro.

Este projeto começou como `tts-wsapi`. Agora tem um motor neural próprio e não depende das vozes da Web Speech API instaladas no navegador ou no sistema.

Repositório: [mtcporto/voz-local](https://github.com/mtcporto/voz-local).

## Como funciona

- Usa `onnxruntime-web` para executar os modelos ONNX no navegador.
- Tenta usar **WebGPU** para melhor desempenho.
- Usa **WASM/CPU** como fallback.
- Oferece dez estilos de voz neurais (Sarah, Lily, Jessica, Olivia, Emily, Alex, James, Robert, Sam e Daniel).
- Gera e reproduz o áudio localmente com `AudioContext`.
- Armazena os modelos e vozes no Cache Storage após o primeiro download.

## Executar

Requisitos: Node.js 22.12 ou superior e npm. É necessário usar um servidor local; abrir o HTML diretamente não é suficiente para módulos e Cache Storage.

```bash
git clone https://github.com/mtcporto/voz-local.git
cd voz-local
npm ci
npm run dev
```

Abra o endereço exibido pelo Vite, normalmente `http://localhost:5173`.

Para testar o build de produção, pare o servidor de desenvolvimento e reutilize a porta 5173, já permitida pelo CORS do bucket:

```bash
npm run build
npm run preview -- --port 5173 --strictPort
```

O build fica em `dist/`. `vite preview` serve para verificação local; para publicar, sirva `dist/` em uma hospedagem estática com HTTPS e autorize seu domínio no CORS do bucket. A porta padrão do preview (4173) não está nas regras locais atuais.

## Onde fica cada parte

| Local | Conteúdo |
| --- | --- |
| GitHub | Código, interface, lockfile, testes e documentação |
| Cloudflare R2 | Quatro modelos ONNX, configurações e dez estilos de voz |
| Navegador | Cache dos arquivos utilizados, inferência e reprodução do áudio |

Os modelos não são incluídos no Git. O endereço público do bucket está em `src/assets.js`; a aplicação não usa credenciais de administração do R2.

## Primeiro uso

Na primeira leitura, o navegador baixa os modelos do nosso bucket Cloudflare R2. Os arquivos são do [Supertonic-3](https://huggingface.co/Supertone/supertonic-3), revisão de origem `3cadd1ee6394adea1bd021217a0e650ede09a323`. Esse download pode demorar e consumir espaço no cache. As execuções seguintes reutilizam os arquivos locais. O indicador de cache completo verifica os quatro modelos e as duas configurações; cada voz é baixada quando selecionada.

O desempenho e a disponibilidade do WebGPU variam conforme navegador, GPU e sistema operacional. O modo WASM funciona sem WebGPU, mas pode ser mais lento.

## Privacidade

O texto não é enviado para um servidor de TTS. Os modelos são obtidos do R2 e a síntese ocorre no dispositivo do usuário. Limpar os dados do site remove o cache. Guardar os arquivos em cache não mantém as sessões ONNX em memória depois de um reload: elas ainda precisam ser reconstruídas.

## Português brasileiro e comparação

A interface e o tratamento de datas, horários, reais, percentuais e abreviações são brasileiros. Os acentos são preservados. Supertonic aceita os identificadores internos `pt` (português) e `na` (automático/multilíngue); não possui um identificador `pt-BR` treinado. Nenhuma das dez vozes é apresentada como tendo sotaque brasileiro garantido.

Em **Comparar pronúncia e qualidade**, a aplicação gera quatro arquivos WAV locais, combinando `pt`/`na` e 5/10 passos. A voz, o texto, a velocidade e a semente aleatória são os mesmos. A reprodução das amostras é exclusiva, e é possível aplicar a configuração preferida. O resultado sonoro precisa ser avaliado ouvindo; mais passos não garantem melhor sotaque. Arquivos de amostra ficam em memória até uma nova comparação ou reload.

## Reprodução e desempenho

- Inferência em worker próprio: WebGPU quando disponível, WASM como alternativa. O motivo do fallback aparece em **Detalhes da leitura**.
- Textos curtos de até 240 caracteres tratados não são divididos apenas pelo tamanho do primeiro trecho; parágrafos e itens de lista continuam separados. Em textos maiores, primeira parte com até 140 caracteres e demais partes com até 240. Frases sem pontuação também têm limite.
- Apenas um áudio tocando e no máximo o próximo trecho sendo gerado. A leitura termina somente quando o último áudio acaba.
- Pausas planejadas: 80 ms entre blocos, 130 ms entre itens, 180 ms entre parágrafos. Silêncio interno do áudio e espera por geração podem acrescentar tempo.
- Parar interrompe o áudio imediatamente. Se houver cálculo ou carregamento pendente, termina o worker; a próxima leitura recarrega as sessões usando o cache. Um worker ocioso permanece pronto.
- Tempos separados para preparar modelos, preparar voz, iniciar áudio, geração de cada trecho e intervalo entre trechos. `extraWaitMs` separa o excesso de intervalo da pausa planejada. O relógio de áudio mede o agendamento, não o primeiro fonema audível nem a saída física do alto-falante.
- O fallback WASM usa uma thread em worker próprio. O teste com quatro threads ficou preso na inicialização neste ambiente; não foi habilitado por padrão. A inicialização do runtime tem limite de 15 segundos. Vite dev/preview enviam os cabeçalhos de isolamento abaixo:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

O CORS do bucket precisa permitir a origem do site. Para produção, incluir o domínio real nas regras do R2; o arquivo `r2-cors.json` contém as origens locais. Não modificar os arquivos do modelo na mesma URL sem versionar os caminhos/cache.

## Verificação

```bash
npm test
npm run build
```

Os testes cobrem parágrafos/listas, limite de trechos, formatos brasileiros, reprodução sequencial, conclusão após o último áudio, Parar e reiniciar, resultados antigos e falha de armazenamento sem download duplicado. A execução real precisa ser verificada no navegador: cache vazio/completo, reload, reprodução longa e comparação das quatro amostras.

Há também regressão específica para a citação curta de Einstein: o texto completo deve permanecer em um trecho, sem uma pausa inserida no meio. Consulte [os resultados e limitações dos testes no navegador](tests/verification.md), incluindo os tempos medidos. Na CPU testada, a geração ainda pode ser mais lenta que a fala; cache completo não elimina essa espera.

## Organização do código

- `src/text.js`: limpeza, formatos brasileiros e divisão do texto.
- `src/synthesis-worker.js`: carregamento e inferência ONNX fora da interface.
- `src/supertonic-engine.js`: reprodução sequencial, cancelamento e medições.
- `src/assets.js`: catálogo, origem dos arquivos e Cache Storage.
- `src/main.js`: interface, preferências e comparação das quatro amostras.
- `tests/engine.test.js`: testes de regressão sem baixar os modelos.

## Modelos e referências

Os pesos e estilos de voz seguem a licença do [Supertonic 3](https://huggingface.co/Supertone/supertonic-3). Hospedar uma cópia no R2 não altera esses termos; consulte a licença upstream antes de redistribuir ou usar os modelos em outro produto.

Referências: [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai), [motor usado pelo PocketPal](https://github.com/a-ghorbani/react-native-speech/tree/v2.5.0/src/engines/supertonic) e [Supertonic](https://github.com/supertone-oss-archive/supertonic). A arquitetura de aplicação, bucket e cache foi mantida.
