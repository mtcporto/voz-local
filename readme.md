# Leitor de Texto - Web Speech API

## Descrição

Este projeto é uma aplicação web que utiliza a Web Speech API para converter texto em fala (text-to-speech). Desenvolvido para funcionar melhor em português do Brasil (pt-BR), o aplicativo permite que os usuários digitem ou colem texto e o ouçam com diferentes vozes disponíveis no navegador.

## Funcionalidades

- Seleção de vozes com preferência para vozes em português brasileiro
- Controles de reprodução: iniciar, pausar, retomar e parar a leitura
- Processamento de texto para melhorar a fala (remoção de marcações markdown)
- Feedback visual do status da leitura
- Design responsivo e interface amigável
- Detecção automática do navegador para sugestão de melhores vozes

## Tecnologias Utilizadas

- **HTML5**: Estrutura da página
- **CSS3**: Estilização com design moderno e animações
- **JavaScript**: Lógica de funcionamento da aplicação
- **Web Speech API**: API nativa dos navegadores para síntese de fala
- **Bootstrap 5**: Framework CSS para layout responsivo
- **Expressões Regulares**: Para processamento de texto

## Compatibilidade

O aplicativo funciona melhor em navegadores baseados em Chromium, especialmente Microsoft Edge, que oferece vozes de alta qualidade em português brasileiro. Chrome, Firefox e outros navegadores modernos também são suportados, porém com qualidade de voz variável.

## Como Usar

1. Abra o arquivo `index.html` em um navegador compatível
2. Selecione uma voz no menu suspenso
3. Digite ou cole o texto que deseja ouvir na área de texto
4. Utilize os botões para controlar a reprodução:
   - Ler Texto: inicia a leitura
   - Pausar: pausa a leitura atual
   - Continuar: retoma a leitura pausada
   - Parar: interrompe completamente a leitura

## Observações

- As vozes disponíveis dependem do sistema operacional e navegador utilizados
- Para melhor experiência, recomendamos o uso do Microsoft Edge que oferece vozes em português de alta qualidade
- O aplicativo funciona offline após o carregamento inicial