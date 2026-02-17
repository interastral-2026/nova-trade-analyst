
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, TradeSignal } from "../types.ts";

export const analyzeMarketData = async (
  symbol: string,
  data: MarketData[],
): Promise<TradeSignal | null> => {
  
  if (!process.env.API_KEY) return null;

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentPrice = data[data.length - 1]?.close || 0;

  const systemInstruction = `YOU ARE PREDATOR_AI_PRO.
GOAL: Detect short-term scalp entries that bypass retail traps and exchange manipulation.
CONCEPTS:
- Market Structure Shift (MSS)
- Liquidity Sweep (Look for long wicks into resistance/support)
- Displacement (Aggressive candles away from manipulation zones)
- FVG retests.
EXIT: Targeted TP at next internal liquidity zone.
TRIGGER: Only if Confidence > 80%.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `SCAN_ASSET: ${symbol} | PRICE: ${currentPrice} | DATA: ${JSON.stringify(data.slice(-30))}` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            side: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
            entryPrice: { type: Type.NUMBER },
            tp: { type: Type.NUMBER },
            sl: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            analysis: { type: Type.STRING }
          },
          required: ['side', 'entryPrice', 'tp', 'sl', 'confidence', 'analysis']
        },
        systemInstruction: systemInstruction,
        temperature: 0.1,
        maxOutputTokens: 40000,
        thinkingConfig: { thinkingBudget: 32768 }
      }
    });

    const result = JSON.parse(response.text.trim());
    if (result.confidence < 80) return null;

    return {
      ...result,
      symbol,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    };
  } catch (e: any) {
    return null;
  }
};
