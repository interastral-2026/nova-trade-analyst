
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, TradeSignal } from "../types.ts";

export const analyzeMarketData = async (
  symbol: string,
  data: MarketData[],
): Promise<TradeSignal | null> => {
  
  if (!process.env.API_KEY) {
    console.warn("Client-side Gemini API key missing. Analysis skipped.");
    return null;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentPrice = data[data.length - 1]?.close || 0;

  const systemInstruction = `YOU ARE NOVA_ELITE_PREDATOR.
CORE LOGIC:
1. DETECT LIQUIDITY TRAPS: Look for rejection wicks past key highs/lows.
2. ROI CALCULATION: Deduction 1.2% total fees.
3. STRICT CONFIDENCE: 
   - <70%: NEUTRAL/HOLD.
   - 70-74%: DISPLAY ONLY.
   - 75%+: AUTO-TRADE TRIGGER.
4. CONSERVATIVE TP: Target 85% of technical move.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `SCAN_ASSET: ${symbol} | PRICE: ${currentPrice} | HIST: ${JSON.stringify(data.slice(-20))}` }] }],
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
            netRoiExpected: { type: Type.STRING }
          },
          required: ['side', 'entryPrice', 'takeProfit', 'stopLoss', 'confidence', 'analysis', 'netRoiExpected']
        },
        systemInstruction: systemInstruction,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 32768 }
      }
    });

    const result = JSON.parse(response.text.trim());
    if (result.confidence < 70) return null;

    return {
      ...result,
      symbol,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      estimatedFees: currentPrice * 0.006,
      timeframe: 'ELITE_SCAN',
      indicators: { rsi: 0, macd: 'SMC', trend: 'PREDATOR_FLOW' }
    };
  } catch (e: any) {
    console.error("Gemini Analysis Error:", e);
    return null;
  }
};
