# Binary AI Trader Universal — publicação no Render

Esta versão exibe candles Forex de 1 minuto da Twelve Data através de um servidor Node.js. A chave fica no servidor e não no navegador. O sinal permanece AGUARDAR; não há estratégia validada nem execução de ordens. Forex normal não substitui feeds OTC específicos de cada corretora.

## Publicar
1. Crie um repositório GitHub e envie o conteúdo desta pasta para a raiz.
2. No Render, escolha New + > Web Service e conecte o repositório.
3. Runtime: Node; Build Command: `npm install`; Start Command: `npm start`.
4. Em Environment, crie `TWELVE_DATA_API_KEY` e cole sua chave Twelve Data diretamente ali.
5. Faça deploy.

Teste `/api/health` no endereço do serviço. Depois teste `/api/candles?symbol=EUR%2FUSD&interval=1min`.

Nunca coloque a chave em HTML, JavaScript do navegador, GitHub ou conversa. Se a chave for exposta, revogue-a e gere outra. Plano gratuito do Render pode suspender o serviço após inatividade.
