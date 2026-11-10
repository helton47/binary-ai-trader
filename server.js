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
    const url = new URL("https://api.twelvedata.com/time_series");
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
