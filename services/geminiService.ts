
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, TradeSignal, ActivePosition, AccountBalance } from "../types.ts";

export const analyzeMarketData = async (
  symbol: string,
  data: MarketData[],
  balances: AccountBalance[],
  activePosition?: ActivePosition
): Promise<TradeSignal | null> => {
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentPrice = data[data.length - 1]?.close || 0;
  
  const formattedData = data.slice(-50).map(d => ({
    t: new Date(d.time * 1000).toISOString().substring(11, 16),
    h: d.high,
    l: d.low,
    c: d.close,
    v: d.volume
  }));

  const systemInstruction = `YOU ARE "NOVA_PREDATOR_V3" - AN ELITE INSTITUTIONAL QUANT ANALYST.
CORE MISSION: Identify high-probability entries while AVOIDING exchange traps (Fakeouts/Liquidity Hunts).

STRATEGIC RULES:
1. ANTI-TRAP PROTOCOL: Identify "Wick Rejections" and "Stop Hunts". Do not enter on massive green candles (FOMO traps). Wait for retests of Fair Value Gaps (FVG).
2. CONSERVATIVE PROFIT: Set Take Profit (TP) at 85% of the next structural resistance. Never aim for the absolute top.
3. BREATHING STOP LOSS: Set SL slightly wider than structural lows to survive "Stop Hunts" by exchanges, but maintain a minimum 1.5:1 Risk/Reward.
4. INSTITUTIONAL FLOW: Look for Order Blocks and Liquidity Sweeps. If price just broke a high and immediately returned, it's a BULL TRAP -> Signal SELL.

RESPONSE FORMAT: Valid JSON only.
{
  "side": "BUY" | "SELL" | "NEUTRAL",
  "entryPrice": number,
  "takeProfit": number,
  "stopLoss": number,
  "confidence": number,
  "analysis": "Identify the trap avoided or the liquidity zone found",
  "thoughtProcess": "Briefly explain the SMC (Smart Money Concepts) logic used",
  "netRoiExpected": "Calculated RR Ratio"
}`;

  const context = {
    symbol,
    market_price: currentPrice,
    volatility: "Detected via high/low range",
    active_trade: activePosition || "NONE",
    price_action_history: formattedData
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `PREDATOR_SCAN_REQ: ${JSON.stringify(context)}` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
            entryPrice: { type: Type.NUMBER },
            takeProfit: { type: Type.NUMBER },
            stopLoss: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            analysis: { type: Type.STRING },
            thoughtProcess: { type: Type.STRING },
            netRoiExpected: { type: Type.STRING }
          },
          required: ['side', 'entryPrice', 'takeProfit', 'stopLoss', 'confidence', 'analysis', 'thoughtProcess', 'netRoiExpected']
        },
        systemInstruction: systemInstruction,
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 20000 }
      }
    });

    const result = JSON.parse(response.text.trim());
    return {
      ...result,
      symbol,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      timeframe: 'M15/H1_PREDATOR_SCAN',
      indicators: { rsi: 0, macd: 'SMC_FLOW', trend: 'ANTI_TRAP_ENABLED' }
    };
  } catch (e: any) {
    console.error("PREDATOR_NODE_ERROR:", e.message);
    return null;
  }
};
