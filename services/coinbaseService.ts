
import { MarketData, AssetInfo } from "../types.ts";

/**
 * GHOST_STABILITY_V3: SWITCHED TO CRYPTOCOMPARE
 * CryptoCompare provides excellent browser-side support without strict CORS/User-Agent headers.
 */

const CRYPTO_COMPARE_URL = 'https://min-api.cryptocompare.com/data';

export const fetchMarketCandles = async (product_id: string, granularity: string = 'ONE_HOUR'): Promise<MarketData[]> => {
  try {
    const [fsym, tsym] = product_id.split('-');
    const limit = 40;
    
    // Mapping granularity to CryptoCompare endpoints
    let endpoint = 'v2/histohour';
    if (granularity === 'ONE_MINUTE') endpoint = 'v2/histominute';
    if (granularity === 'ONE_DAY') endpoint = 'v2/histoday';

    const response = await fetch(`${CRYPTO_COMPARE_URL}/${endpoint}?fsym=${fsym}&tsym=${tsym}&limit=${limit}`);
    const json = await response.json();
    
    if (json.Response === "Error") throw new Error(json.Message);
    
    const data = json.Data.Data;
    return data.map((d: any) => ({
      time: d.time,
      low: d.low,
      high: d.high,
      open: d.open,
      close: d.close,
      volume: d.volumeto // Use volumeto for better liquidity representation
    }));
  } catch (e) {
    console.error(`Data Source Error for ${product_id}:`, e);
    return [];
  }
};

export const fetchProductStats = async (product_id: string): Promise<AssetInfo> => {
  try {
    const [fsym, tsym] = product_id.split('-');
    const response = await fetch(`${CRYPTO_COMPARE_URL}/pricemultifull?fsyms=${fsym}&tsyms=${tsym}`);
    const json = await response.json();
    
    if (!json.RAW || !json.RAW[fsym] || !json.RAW[fsym][tsym]) {
      throw new Error("EMPTY_DATA");
    }

    const raw = json.RAW[fsym][tsym];

    return {
      id: product_id,
      name: fsym,
      price: raw.PRICE.toString(),
      change24h: raw.CHANGEPCT24HOUR || 0,
      volume: raw.VOLUME24HOURTO.toString(),
      marketCap: raw.MKTCAP ? raw.MKTCAP.toString() : 'N/A'
    };
  } catch (error) {
    return {
      id: product_id,
      name: product_id.split('-')[0],
      price: '0',
      change24h: 0,
      volume: '0',
      marketCap: 'N/A'
    };
  }
};
