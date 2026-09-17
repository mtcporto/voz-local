# Verificação de 17/09/2026

Ambiente: Chromium headless 153, Linux, Supertonic 3, WASM/CPU em worker próprio, uma thread, F1, velocidade 1,05. Valores de uma execução, sujeitos à carga da máquina. Não são comparação auditiva nem promessa de latência em outro dispositivo.

## Resultado

- Doze testes automatizados passaram (`npm test`), incluindo a regressão posterior que mantém a citação curta de Einstein em um único trecho e o limite de 240 caracteres.
- Build de produção e `git diff --check` passaram.
- Interface verificada em dev e preview de produção, desktop e 390 px, sem overflow horizontal ou overlay de erro; dez vozes disponíveis.
- Reload: cache completo reconhecido; leitura seguinte carregou sete arquivos do cache, zero downloads.
- Stop durante geração: interface liberada em 1,2 ms (tempo do handler, não medição de latência física de áudio).
- Stop durante reprodução: interface liberada em 1,2 ms. Reprodução e geração antigas não reiniciaram.
- Texto de 540 caracteres com dois parágrafos, lista numerada e lista com marcadores: oito de oito trechos concluídos. A fila exclusiva e o limite de uma geração adiantada também foram verificados nos testes automatizados.
- Monitor de responsividade durante a leitura longa: intervalo nominal de 50 ms, maior intervalo observado de 64,8 ms. Isso indica que a inferência não bloqueou a página nesse teste.
- Quatro amostras reais geradas; WAVs com duração válida e sinal não silencioso, sem saturação nos arquivos inspecionados. Ao iniciar outro player, o anterior pausou (um ativo).
- Aplicar automático/dez passos e recarregar preservou a preferência. Ao final, português/cinco passos foram restaurados.

## Tempos

| Cenário | Modelos | Voz | Primeiro áudio | Total até fim |
| --- | ---: | ---: | ---: | ---: |
| Após reload, 93 caracteres, cache completo | 4,05 s | 0,04 s | 20,49 s | 28,21 s |
| Leitura longa, motor já em memória | 0 s | <0,01 s | 17,99 s | 108,67 s |

Na leitura longa, os intervalos entre blocos foram de 80 ms a 21,56 s. A CPU nem sempre gerou o próximo trecho antes do fim do áudio atual. As pausas planejadas são pequenas; a espera extra está separada em `extraWaitMs`. A continuidade lógica está corrigida, mas este ambiente ainda não oferece fala contínua em tempo real.

## Comparação controlada

Texto: “Bom dia! Hoje vamos conversar sobre o Brasil. Você prefere café com leite ou suco de laranja?”

Mesma voz F1, velocidade 1,05 e semente 20260917. Tempos abaixo são somente de inferência, excluindo carregar modelos/voz.

| Idioma | Passos | Geração | Áudio |
| --- | ---: | ---: | ---: |
| Português (`pt`) | 5 | 15,46 s | 7,71 s |
| Automático (`na`) | 5 | 15,56 s | 7,67 s |
| Português (`pt`) | 10 | 28,04 s | 7,71 s |
| Automático (`na`) | 10 | 28,00 s | 7,67 s |

A preferência de sotaque/naturalidade precisa de avaliação auditiva do usuário. Não se concluiu que automático ou dez passos soam melhores.

## Limitações verificadas

- WebGPU: nenhum adaptador disponível no navegador de teste; caminho configurado, mas inferência GPU não validada neste hardware.
- Quatro threads: inicialização ficou presa no teste com isolamento de origem. O padrão final é uma thread e a inicialização do runtime tem timeout de 15 s.
- Downloads com cache completamente vazio não foram repetidos nesta rodada. A falha de quota sem download duplicado foi testada com simulação.
- O smoke test do preview validou a interface/bundle. Os testes reais de síntese ocorreram na origem localhost:5173, já permitida no CORS do bucket.
