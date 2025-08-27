import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { getUserTokenDetailsB } from './getCoinDetails.js';

const client = new SuiClient({
  url: getFullnodeUrl('mainnet'),
});

async function fetchWithRetry(client, coinType, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const metadata = await client.getCoinMetadata({ coinType });
      return metadata;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export function withTimeout(promise, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timeoutId);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

export async function getTokensInWallet(walletAddress) {
  const tokens = [];

  const coinTypes = await client.getAllBalances({ owner: walletAddress });

  for (const coin of coinTypes) {
    const { coinType, totalBalance } = coin;

    if (BigInt(totalBalance) === 0n) continue;

    try {
      const metadata = await client.getCoinMetadata({ coinType: coin.coinType });

      tokens.push({
        tokenAddress: coinType,
        symbol: metadata?.symbol || "???",
        decimals: metadata?.decimals || 0,
        balance: totalBalance,
      });
    } catch (err) {
      console.error("Failed to fetch metadata:", err.message);
    }
  }

  return tokens;
}

export function formatPrice(price) {
  if (price >= 1_000_000_000) {
    return `$${(price / 1_000_000_000).toFixed(1)}B`;
  } else if (price >= 1_000_000) {
    return `$${(price / 1_000_000).toFixed(1)}M`;
  } else if (price >= 1_000) {
    return `$${(price / 1_000).toFixed(1)}K`;
  }
  return `$${price}`;
}

export function formatTinyPrice(price) {
  const num = Number(price);
  if (!num || num === 0) return "$0";

  if (num >= 0.0001) {
    // Normal price formatting for larger prices
    return `$${num.toFixed(4)}`;
  }

  const parts = num.toString().split(".");
  const decimals = parts[1] || "";
  const match = decimals.match(/^0*/);
  const leadingZeroes = match ? match[0].length : 0;
  const significant = decimals.slice(leadingZeroes, leadingZeroes + 3); // Show first 3 digits

  const subscriptMap = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉"
  };

  const subscript = [...leadingZeroes.toString()].map(d => subscriptMap[d] || d).join("");

  return `$0.0${subscript}${significant}`;
}

export function formatBigNumber(num) {
  const number = Number(num);
  if (number >= 1_000_000_000) {
    return `$${(number / 1_000_000_000).toFixed(2)}B`;
  } else if (number >= 1_000_000) {
    return `$${(number / 1_000_000).toFixed(2)}M`;
  } else if (number >= 1_000) {
    return `$${(number / 1_000).toFixed(2)}K`;
  } else if (number > 0) {
    return `$${number.toFixed(2)}`;
  } else {
    return "$0";
  }
}


export async function getFallbackTokenDetails(tokenAddress, walletAddress, options = {}) {
  const { skipPriceInSui = false, suiUsdPrice: injectedSuiUsdPrice } = options;

  // Handle native SUI immediately
  if (tokenAddress === "0x2::sui::SUI") {
    return {
      tokenInfo: {
        price: 1,
        priceInSui: 1,
        symbol: "SUI",
        decimals: 9,
      },
      source: "Native",
    };
  }

  // Helper to wrap with timeout
  const safeFetch = (fn, name, timeout = 15000) =>
    withTimeout(fn(), timeout)
      .then(res => {
        if (!res || (Array.isArray(res) && res.length === 0)) {
          throw new Error(`${name} returned empty result`);
        }
        return res;
      })
      .catch(err => {
        console.log(`${name} failed:`, err.message || err);
        throw err; // important so Promise.any skips it
      });

  try {
    // Run both in parallel and take whichever succeeds first
    const result = await Promise.any([
      safeFetch(() => getTokenDetails(tokenAddress, walletAddress), "Dexscreener", 1200),
      safeFetch(() => getInsidexTokenDetails(tokenAddress), "Insidex", 5000)
    ]);

    if (!result) {
      return { tokenInfo: null, source: null }; // early exit if null
    }

    let tokenInfo = Array.isArray(result) ? result[0] : result;
    let source = result?.source ?? (result?.coinMetadata ? "Insidex" : "Dexscreener");
    
    // Add this: check if marketCap exists from the API
    if (tokenInfo) {
      tokenInfo.marketCap = tokenInfo.marketCap ?? result?.fdv ?? null;
    }

    // If no token info found
    if (!tokenInfo) return { tokenInfo: null, source: null };

    // Calculate priceInSui if needed
    if (!skipPriceInSui) {
      try {
        if (tokenInfo.price > 0) {
          const suiUsd = injectedSuiUsdPrice
            ?? await safeFetch(() => getSuiUsdPrice(walletAddress), "getSuiUsdPrice", 1800).catch(() => null);
          tokenInfo.priceInSui = suiUsd && !isNaN(suiUsd) ? tokenInfo.price / suiUsd : 0;
        } else {
          tokenInfo.priceInSui = 0;
        }
      } catch {
        tokenInfo.priceInSui = 0;
      }
    } else {
      tokenInfo.priceInSui = 0;
    }

    return { tokenInfo, source };

  } catch (err) {
    console.error("❌ Both sources failed:", err);
    return { tokenInfo: null, source: null };
  }
}

export function abbreviateNumber(num) {
  const absNum = Math.abs(num);
  let value, suffix = "";

  if (absNum >= 1_000_000_000) {
    value = num / 1_000_000_000;
    suffix = "B";
  } else if (absNum >= 1_000_000) {
    value = num / 1_000_000;
    suffix = "M";
  } else if (absNum >= 1_000) {
    value = num / 1_000;
    suffix = "K";
  } else {
    return num.toFixed(num < 1 ? 4 : 2);
  }

  const formatted = value.toFixed(1).replace(/\.0$/, "");
  return formatted + suffix;
}

export function formatSmallPrice(price) {
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.01) return `$${price.toFixed(6)}`;
  if (price >= 0.001) return `$${price.toFixed(7)}`;
  // Handle very small numbers with subscript notation like $0.0₅306
  const str = price.toFixed(20);
  const match = str.match(/^0\.0+/);
  if (match) {
    const zeros = match[0].length - 2; // subtract "0."
    const significant = str.slice(match[0].length, match[0].length + 3);
    if (zeros >= 3) {
      return `$0.0₀${zeros}${significant}`;
    }
  }
  return `$${price.toFixed(8)}`;
}

export function formatMarketCap(marketCap) {
  if (marketCap >= 1000000000) return `$${(marketCap / 1000000000).toFixed(2)}B`;
  if (marketCap >= 1000000) return `$${(marketCap / 1000000).toFixed(2)}M`;
  if (marketCap >= 1000) return `$${(marketCap / 1000).toFixed(2)}K`;
  return `$${marketCap.toFixed(2)}`;
}

export function formatTokenBalance(balance) {
  if (balance >= 1000000) return `${(balance / 1000000).toFixed(2)}M`;
  if (balance >= 1000) return `${(balance / 1000).toFixed(2)}K`;
  return balance.toFixed(2);
}

export function formatPriceAbbreviated(price) {
  if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(1)}M`;
  if (price >= 1_000) return `$${(price / 1_000).toFixed(1)}K`;
  return `$${price.toFixed(2)}`;
}

export function formatPricePrecise(value) {
  const num = Number(value);
  if (isNaN(num)) return "0.000";
  if (num >= 1) return num.toFixed(3);
  return num.toPrecision(2);
}

export async function getSuiUsdPrice(walletAddress) {
  const fallback = await getFallbackTokenDetails("0x2::sui::SUI", walletAddress, {
    skipPriceInSui: true,
  });
  return fallback?.tokenInfo?.price ?? 0;
}

export const getTokenDetails = async (token, walletAddress) => {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, {
    method: 'GET',
    headers: {},
  });

  const responseData = await response.json();
  if (!responseData.pairs || !Array.isArray(responseData.pairs) || responseData.pairs.length === 0) {
    return null;
  }
  const data = responseData.pairs[0];
  return normalizeTokenData(data, "Dexscreener");
}

export function normalizeTokenData(data, source) {
  if (source === "Dexscreener") {
    return {
      name: data.baseToken.name || null,
      symbol: data.baseToken.symbol || null,
      address: data.baseToken.address || null,
      marketCap: data.marketCap || null,
      price: data.priceUsd ?? null,
      decimals: data.quoteToken.symbol || null,
      date: data.pairCreatedAt || null,
      source: "Dexscreener"
    }
  } else if (source === "Insidex") {
    return {
      name: data.coinMetadata.name || null,
      symbol: data.coinMetadata.symbol || null,
      address: data.coinMetadata.coinType || null,
      marketCap: data.marketCap || null,
      price: data.coinPrice ?? null,
      decimals: data.coinMetadata.decimals ?? null,
      date: data.totalLiquidityUsd || null,
      source: "InsideX"
    };
  }
  return null;
}

export const getInsidexTokenDetails = async (token) => {
  const myHeaders = new Headers();
  myHeaders.append("x-api-key", process.env.INSIDEX_KEY);
  try {
    const response = await fetch(`https://api-ex.insidex.trade/coins/${token}/market-data`, {
      method: 'GET',
      headers: myHeaders,
      redirect: 'follow'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Insidex failed: ${response.status} ${response.statusText} - ${errorText}`);
      return null;
    }

    const data = await response.json();

    // If it's an object, normalize it directly
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return normalizeTokenData(data, "Insidex");
    }

    // If it's already an array, normalize each item
    if (Array.isArray(data)) {
      return data.map(item => normalizeTokenData(item, "Insidex"));
    }

    console.error("❌ Unexpected response structure:", data);
    return null;
  } catch (error) {
    console.error("❌ Fetch error:", error);
    return null;
  }
};

export const getTokenPriceSui = async (token) => {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, {
    method: 'GET',
    headers: {},
  });
  const responseData = await response.json();
  const data = responseData.pairs[0];
  return Number(data.priceNative)
}

export const getCoinBalance = async (address, coinType = '0x2::sui::SUI') => {
  const details = await getUserTokenDetailsB(address, coinType)
  if (details === null) {
    return ({ balance: 0, balanceUsd: 0, decimals: 0 });
  } else {
    return ({ balance: details.balance, balanceUsd: details.balanceUsd, decimals: details.decimals });
  }
}