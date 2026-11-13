
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY;

app.use(express.static(path.join(__dirname, "public")));

const CACHE_TIME = 60 * 1000;
const candleCache = new Map();
const pendingRequests = new Map();

const ALLOWED_SYMBOLS = new Set([
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "USD/CHF",
  "AUD/USD",
  "NZD/USD",
  "USD/CAD",
  "EUR/GBP",
  "EUR/JPY",
  "GBP/JPY"
]);

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    apiKeyConfigured: Boolean(API_KEY),
    cacheSeconds: CACHE_TIME / 1000,
    supportedSymbols: [...ALLOWED_SYMBOLS]
  });
});

async function getCandles(symbol) {
  if (!API_KEY) {
    throw new Error("A chave TWELVE_DATA_API_KEY não está configurada.");
  }

  if (!ALLOWED_SYMBOLS.has(symbol)) {
    throw new Error("Par de moedas não permitido.");
  }

  const cached = candleCache.get(symbol);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TIME) {
    return cached;
  }

  if (pendingRequests.has(symbol)) {
    return pendingRequests.get(symbol);
  }

  const request = (async () => {
    const url = new URL("https://api.twelvedata.com/time_series");

    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "1min");
    url.searchParams.set("timezone", "America/Sao_Paulo");
    url.searchParams.set("outputsize", "100");
    url.searchParams.set("apikey", API_KEY);

    const response = await fetch(url);
    const data = await response.json();

    if (
      !response.ok ||
      data.status === "error" ||
      !Array.isArray(data.values) ||
      data.values.length < 30
    ) {
      throw new Error(
        data.message || "Não foi possível obter candles da Twelve Data."
      );
    }

    const providerLatestCandle = data.values[0].datetime;

    // Exclui o candle mais recente, que pode ainda estar aberto.
    const values = data.values.slice(1).map(v => ({
      datetime: v.datetime,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close)
    })).reverse();

    if (values.some(c => !Number.isFinite(c.close))) {
      throw new Error("A Twelve Data retornou candles com valores inválidos.");
    }

    const result = {
      values,
      providerLatestCandle,
      fetchedAt: Date.now()
    };

    candleCache.set(symbol, result);

    return result;
  })();

  pendingRequests.set(symbol, request);

  try {
    return await request;
  } finally {
    pendingRequests.delete(symbol);
  }
}

function dataInfo(data) {
  const last = data.values[data.values.length - 1];

  return {
    providerLatestCandle: data.providerLatestCandle,
    lastAnalyzedCandle: last ? last.datetime : null,
    fetchedAt: new Date(data.fetchedAt).toISOString(),
    dataAgeSeconds: Math.max(
      0,
      Math.floor((Date.now() - data.fetchedAt) / 1000)
    ),
    cacheSeconds: CACHE_TIME / 1000
  };
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

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    avgGain = (
      avgGain * (period - 1) + Math.max(change, 0)
    ) / period;

    avgLoss = (
      avgLoss * (period - 1) + Math.max(-change, 0)
    ) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

// Exemplo: análise às 22:45:30,
// entrada às 22:47 e expiração às 22:48.
// É um horário-alvo experimental, não uma previsão garantida.
function futureSchedule(now = Date.now()) {
  const minuteStart = Math.floor(now / 60000) * 60000;
  const entry = minuteStart + 2 * 60000;
  const expiry = entry + 60000;

  return {
    analysisTime: new Date(now).toISOString(),
    entryTime: new Date(entry).toISOString(),
    expiryTime: new Date(expiry).toISOString(),
    entryDelaySeconds: Math.max(
      0,
      Math.ceil((entry - now) / 1000)
    )
  };
}

app.get("/api/candles", async (req, res) => {
  try {
    const symbol = String(
      req.query.symbol || "EUR/USD"
    ).toUpperCase();

    const candleData = await getCandles(symbol);

    res.set("Cache-Control", "no-store");

    res.json({
      symbol,
      interval: "1min",
      values: candleData.values,
      dataInfo: dataInfo(candleData)
    });
  } catch (error) {
    res.status(502).json({
      error: error.message
    });
  }
});

app.get("/api/signal", async (req, res) => {
  try {
    const symbol = String(
      req.query.symbol || "EUR/USD"
    ).toUpperCase();

    const candleData = await getCandles(symbol);
    const candles = candleData.values;

    if (candles.length < 30) {
      return res.status(422).json({
        signal: "AGUARDAR",
        reason: "Dados insuficientes para análise.",
        dataInfo: dataInfo(candleData),
        schedule: futureSchedule()
      });
    }

    const closes = candles.map(c => c.close);

    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const rsi14 = calculateRSI(closes, 14);

    const last = candles[candles.length - 1];
    const previous = candles[candles.length - 2];

    const momentum = last.close - previous.close;

    let signal = "AGUARDAR";
    let reason = "Condições da estratégia experimental não confirmadas.";

    // Regras técnicas iniciais, ainda não validadas.
    if (
      ema9 > ema21 &&
      rsi14 >= 52 &&
      rsi14 <= 67 &&
      last.close > ema9 &&
      momentum > 0
    ) {
      signal = "CALL";
      reason = "Tendência e momentum de alta alinhados nos candles fechados.";
    } else if (
      ema9 < ema21 &&
      rsi14 >= 33 &&
      rsi14 <= 48 &&
      last.close < ema9 &&
      momentum < 0
    ) {
      signal = "PUT";
      reason = "Tendência e momentum de baixa alinhados nos candles fechados.";
    }

    res.set("Cache-Control", "no-store");

    res.json({
      symbol,
      interval: "1min",
      signal,
      reason,

      indicators: {
        ema9: Number(ema9.toFixed(6)),
        ema21: Number(ema21.toFixed(6)),
        rsi14: Number(rsi14.toFixed(2))
      },

      lastAnalyzedCandle: last.datetime,
      candlesAnalyzed: candles.length,
      schedule: futureSchedule(),
      dataInfo: dataInfo(candleData),
      experimental: true
    });

  } catch (error) {
    res.status(502).json({
      signal: "AGUARDAR",
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log("Binary AI Trader running on port " + PORT);
});
