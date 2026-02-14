
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, TradeSignal, ActivePosition, AccountBalance } from "../types.ts";

export const analyzeMarketData = async (
  symbol: string,
  data: MarketData[],
  balances: AccountBalance[],
  activePosition?: ActivePosition
): Promise<TradeSignal | null> => {
  
  // ایجاد نمونه جدید در هر بار فراخوانی برای اطمینان از دریافت آخرین کلید انتخابی کاربر
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const currentPrice = data[data.length - 1]?.close || 0;
  
  const formattedData = data.slice(-40).map(d => ({
    t: new Date(d.time * 1000).toISOString().substring(11, 16),
    p: d.close,
    v: d.volume
  }));

  const systemInstruction = `YOU ARE THE "ELITE_QUANT_NAVIGATOR". 
CORE DIRECTIVE: Analyze market data and manage open positions with extreme precision.

MANDATORY RESPONSE PROTOCOL:
1. IDENTIFY ENTRY: If "active_node" exists, use its "entry_price" as the absolute reference for SL/TP.
2. RISK MANAGEMENT: 
   - If Profit > 2%, move SL to Entry (Break-even).
   - If Trend reverses, issue SELL signal to protect capital.
3. SCALPING LOGIC: Use Smart Money Concepts to find liquidity zones.

OUTPUT RULE:
You MUST return valid JSON. No conversational text.
If no clear move, side is NEUTRAL but TP/SL must still be logical based on current price.

JSON SCHEMA:
{
  "side": "BUY" | "SELL" | "NEUTRAL",
  "entryPrice": number,
  "takeProfit": number,
  "stopLoss": number,
  "confidence": number,
  "analysis": "Summary of technical bias",
  "thoughtProcess": "Deep dive into logic including Entry Price consideration",
  "netRoiExpected": "RRR ratio"
}`;

  const context = {
    symbol,
    market_price: currentPrice,
    // تشخیص دقیق قیمت خرید از پوزیشن‌های فعال یا موجودی کیف پول
    active_node: activePosition ? {
      entry_price: activePosition.entryPrice,
      pnl_pct: activePosition.pnlPercent,
      size: activePosition.size
    } : (balances.find(b => symbol.startsWith(b.currency))?.total || 0) > 0 ? {
      entry_price: currentPrice, // فرض قیمت فعلی به عنوان ورود برای ارزهای موجود
      status: "EXISTING_BALANCE_DETECTED"
    } : "NO_ACTIVE_POSITION",
    price_action_history: formattedData
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview', // استفاده از مدل Pro برای تحلیل عمیق‌تر
      contents: [{ parts: [{ text: `EXECUTE_ANALYSIS_REQUEST: ${JSON.stringify(context)}` }] }],
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
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 15000 } // فعال‌سازی قابلیت تفکر برای محاسبات ریاضی دقیق‌تر SL/TP
      }
    });

    if (!response.text) {
      throw new Error("EMPTY_AI_RESPONSE");
    }

    const result = JSON.parse(response.text.trim());
    return {
      ...result,
      symbol,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      timeframe: 'H1_SMC_QUANT',
      indicators: { rsi: 0, macd: 'INSTITUTIONAL_FLOW', trend: 'LIQUIDITY_MAP' }
    };
  } catch (e: any) {
    console.error("ANALYSIS_ERROR:", e.message);
    // بازگرداندن یک سیگنال خنثی همراه با دلیل خطا در بخش thoughtProcess برای نمایش به کاربر
    return {
      id: 'err-' + Date.now(),
      symbol,
      side: 'NEUTRAL',
      entryPrice: currentPrice,
      takeProfit: currentPrice * 1.05,
      stopLoss: currentPrice * 0.95,
      confidence: 0,
      timeframe: 'ERR',
      analysis: "AI_NODE_CONNECTION_ERROR",
      thoughtProcess: `Error: ${e.message}. Please ensure API Key is valid and billing is active.`,
      timestamp: new Date().toISOString(),
      netRoiExpected: "0",
      indicators: { rsi: 0, macd: 'ERR', trend: 'ERR' }
    };
  }
};
