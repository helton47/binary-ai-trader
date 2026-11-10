
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, apiKeyConfigured: Boolean(API_KEY) });
});

async function getCandles(symbol) {
  if (!API_KEY) {
    throw new Error("Twelve Data API key not configured.");
  }

  if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol)) {
    throw new Error("Invalid currency pair.");
  }

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1min");
  url.searchParams.set("outputsize", "100");
  url.searchParams.set("apikey", API_KEY);

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.status === "error" || !Array.isArray(data.values)) {
    throw new Error(data.message || "Twelve Data request failed.");
  }

  return data.values.slice(1).map(v => ({
    datetime: v.datetime,
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close)
  })).reverse();
}

function calculateEMA(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

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

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) return 100;

  const rs = averageGain / averageLoss;
  return 100 - (100 / (1 + rs));
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

app.get("/api/signal", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "EUR/USD").toUpperCase();
    const candles = await getCandles(symbol);

    if (candles.length < 30) {
      return res.status(422).json({
        signal: "AGUARDAR",
        reason: "Insufficient data for analysis."
      });
    }

    const closes = candles.map(c => c.close);
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const rsi14 = calculateRSI(closes, 14);
    const lastClose = closes[closes.length - 1];

    let signal = "AGUARDAR";
    let reason = "Strategy conditions not confirmed.";

    if (ema9 > ema21 && rsi14 >= 52 && rsi14 <= 68 && lastClose > ema9) {
      signal = "CALL";
      reason = "Uptrend conditions confirmed.";
    } else if (ema9 < ema21 && rsi14 >= 32 && rsi14 <= 48 && lastClose < ema9) {
      signal = "PUT";
      reason = "Downtrend conditions confirmed.";
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
      lastAnalyzedCandle: candles[candles.length - 1].datetime,
      candlesAnalyzed: candles.length
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
