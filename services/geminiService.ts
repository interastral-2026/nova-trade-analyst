
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, TradeSignal } from "../types.ts";

export const analyzeMarketData = async (
  symbol: string,
  data: MarketData[],
): Promise<TradeSignal | null> => {
  
  if (!process.env.API_KEY) return null;

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentPrice = data[data.length - 1]?.close || 0;

  const systemInstruction = `YOU ARE PREDATOR_AI_FLASH.
GOAL: High-speed scalp analysis. Avoid "Liquidity Wicks" and "Retail Traps".
CONCEPTS:
- Look for Market Structure Shifts (MSS) after a Liquidity Sweep.
- Only trigger if the candle shows strong displacement.
- Target internal liquidity gaps (FVG).
THRESHOLD: 80% Confidence required for BUY.
BE CONCISE.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `SCAN_ASSET: ${symbol} | PRICE: ${currentPrice} | DATA: ${JSON.stringify(data.slice(-20))}` }] }],
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
        thinkingConfig: { thinkingBudget: 2048 } // Low budget for maximum speed
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
    console.error(`Gemini Service Error: ${e.message}`);
    return null;
  }
};
