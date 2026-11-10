
Isso
Perfeito! Vamos transformar o painel em um sistema que analisa os candles e apresenta CALL, PUT ou AGUARDAR.

Antes, precisamos conferir o arquivo que recebe os dados da Twelve Data. Não vamos mexer no código ainda.

Próximo passo:

Volte à página principal do repositório, onde aparecem os arquivos.

Toque em server.js.

Quando o código abrir, copie e cole aqui, como você fez com o index.html.

Assim vou verificar como os dados chegam ao aplicativo e preparar o próximo passo. Os sinais precisarão ser testados antes de qualquer uso com dinheiro real; não há garantia de acerto ou lucro.

const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY;
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/health", (_req, res) => res.json({ok:true, apiKeyConfigured:Boolean(API_KEY)}));
app.get("/api/candles", async (req,res) => {
  if (!API_KEY) return res.status(503).json({error:"Chave Twelve Data não configurada no servidor."});
  const symbol = String(req.query.symbol || "EUR/USD").toUpperCase();
  const interval = String(req.query.interval || "1min");
  if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol) || interval !== "1min")
    return res.status(400).json({error:"Par ou intervalo inválido."});
  try {
    const url = new URL("");
    url.searchParams.set("symbol",symbol); url.searchParams.set("interval",interval);
    url.searchParams.set("outputsize","30"); url.searchParams.set("apikey",API_KEY);
    const response = await fetch(url); const data = await response.json();
    if (!response.ok || data.status === "error" || !Array.isArray(data.values))
      return res.status(502).json({error:data.message || "Falha na consulta Twelve Data.",code:data.code || null});
    res.set("Cache-Control","no-store");
    res.json({symbol,interval,values:data.values.map(v=>({datetime:v.datetime,open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close)}))});
  } catch { res.status(500).json({error:"Falha ao consultar a fonte de cotações."}); }
});
app.listen(PORT,()=>console.log(`Binary AI Trader ativo na porta ${PORT}`));

…
Ótimo! Agora conseguimos entender como o sistema funciona. 👏

O server.js já faz três coisas importantes:

Conecta ao serviço Twelve Data.

Busca até 30 candles de 1 minuto.

Entrega os preços ao painel.

Mas ainda não calcula sinais. Precisamos acrescentar uma estratégia de análise para decidir entre CALL, PUT e AGUARDAR.

Minha sugestão para a primeira versão é usar:

EMA 9 e EMA 21: identificar a direção da tendência.

RSI 14: avaliar a força do movimento.

Confirmação pelo candle fechado: evitar sinais baseados em candle ainda em formação.

Começaremos com Forex tradicional, em modo de teste. Isso não significa que os sinais terão acerto garantido; e não devemos usar esses dados como se fossem cotações OTC das corretoras.

Você aprova essa estratégia inicial para implementarmos no aplicativo?

Sim
Perfeito! Vamos implementar essa primeira estratégia. 👍

Faremos em duas etapas:

O servidor calculará EMA 9, EMA 21 e RSI 14 e decidirá entre CALL, PUT ou AGUARDAR.

Depois, vamos ligar esse resultado à tela do aplicativo.

A primeira versão será apenas para teste com Forex tradicional. Ela não executará operações e não garante resultados positivos.

Agora vamos substituir o conteúdo do server.js. Não mexa no index.html ainda.

No GitHub, abra server.js, toque no lápis e substitua todo o conteúdo pelo código abaixo.


const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    apiKeyConfigured: Boolean(API_KEY)
  });
});

async function getCandles(symbol) {
  if (!API_KEY) {
    throw new Error("Chave Twelve Data não configurada.");
  }

  if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol)) {
    throw new Error("Par inválido.");
  }

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1min");
  url.searchParams.set("outputsize", "100");
  url.searchParams.set("apikey", API_KEY);

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.status === "error" ||
      !Array.isArray(data.values)) {
    throw new Error(data.message || "Falha na consulta Twelve Data.");
  }

  // A API entrega os candles mais recentes primeiro.
  // Excluímos o candle mais recente para evitar usar um candle em formação.
  return data.values
    .slice(1)
    .map(v => ({
      datetime: v.datetime,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close)
    }))
    .reverse();
}

function calculateEMA(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = values
    .slice(0, period)
    .reduce((sum, value) => sum + value, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateRSI(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    averageGain = ((averageGain * (period - 1)) + gain) / period;
    averageLoss = ((averageLoss * (period - 1)) + loss) / period;
  }

  if (averageLoss === 0) return 100;

  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

app.get("/api/candles", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "EUR/USD").toUpperCase();
    const values = await getCandles(symbol);

    res.set("Cache-Control", "no-store");
    res.json({ symbol, interval: "1min", values });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});
