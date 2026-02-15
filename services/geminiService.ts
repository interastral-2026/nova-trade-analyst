
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, TradeSignal } from "../types.ts";

export const analyzeMarketData = async (
  symbol: string,
  data: MarketData[],
): Promise<TradeSignal | null> => {
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentPrice = data[data.length - 1]?.close || 0;

  const systemInstruction = `YOU ARE NOVA_ELITE_PREDATOR.
CORE LOGIC:
1. DETECT LIQUIDITY TRAPS: Exchange algorithms often push price past highs to hunt stops. Look for rejection wicks.
2. NET ROI CALCULATION: Deduct 1.2% total fees (entry+exit) from any expected move. Only signal if Net ROI > 2%.
3. STRICT CONFIDENCE: 
   - <80%: NEUTRAL/HOLD.
   - 80-84%: DISPLAY ONLY.
   - 85%+: AUTO-TRADE TRIGGER.
4. CONSERVATIVE TP: Target 85% of technical move to avoid "last minute" reversals.
5. DEEP SL: Place SL below order blocks, not just recent lows.`;

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
        thinkingConfig: { thinkingBudget: 25000 }
      }
    });

    const result = JSON.parse(response.text.trim());
    if (result.confidence < 80) return null;

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
    return null;
  }
};
