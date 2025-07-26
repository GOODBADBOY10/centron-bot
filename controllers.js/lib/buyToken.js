import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';

const client = new SuiClient({
  url: getFullnodeUrl('mainnet'),
});


export const getCetusSDK = async (network = 'mainnet') => {
  // Initialize SDK using the simplified method from the official package
  const sdk = initCetusSDK({ network });
  return sdk;
};

export const getTokenDetailsCetus = async (tokenAddress) => {
  try {
    // Initialize SDK using the simplified method
    const sdk = await getCetusSDK('mainnet');

    // Get all pools
    const pools = await sdk.Pool.getPoolsWithPage([], { limit: 100, offset: 0 });

    // Find pools containing the target token
    const relevantPools = pools.filter(pool =>
      pool.coinTypeA === tokenAddress ||
      pool.coinTypeB === tokenAddress
    );

    if (relevantPools.length === 0) {
      return {
        success: false,
        token: tokenAddress,
        message: "No liquidity pools found for this token on Cetus"
      };
    }

    // // Get token metadata - using Coin module in the updated SDK
    const isTokenA = relevantPools[0].coinTypeA === tokenAddress;
    const tokenType = isTokenA ? relevantPools[0].coinTypeA : relevantPools[0].coinTypeB;
    const tokenMetadata = await client.getCoinMetadata({ coinType: tokenType });
    if (!tokenMetadata) {
      return { success: false, token: tokenAddress, message: "Token metadata not available" };
    }
    // Format pool information
    const poolsInfo = await Promise.all(relevantPools.map(async (pool) => {
      const isTokenA = pool.coinTypeA === tokenAddress;
      const pairTokenType = isTokenA ? pool.coinTypeB : pool.coinTypeA;
      const pairTokenData = await client.getCoinMetadata({ coinType: pairTokenType });

      return {
        poolAddress: pool.address,
        pairWith: pairTokenData?.symbol || 'Unknown',
        pairTokenAddress: pairTokenType,
        fee: parseFloat((pool.fee_rate / 10000).toFixed(2)),
        liquidity: parseFloat(pool.tvl || '0'),
        volume24h: parseFloat(pool.volume_24h || '0'),
        price: isTokenA
          ? parseFloat(pool.price_b_per_a || '0')
          : parseFloat(pool.price_a_per_b || '0')
      };
    }));

    // Calculate average price across all pools (weighted by liquidity)
    let totalLiquidity = 0;
    let weightedPriceSum = 0;

    poolsInfo.forEach(pool => {
      if (!isNaN(pool.liquidity) && !isNaN(pool.price)) {
        totalLiquidity += pool.liquidity;
        weightedPriceSum += pool.price * pool.liquidity;
      }
    });

    const averagePrice = totalLiquidity > 0
      ? weightedPriceSum / totalLiquidity
      : null;

    return {
      success: true,
      token: tokenAddress,
      source: "cetus",
      data: {
        symbol: tokenMetadata.symbol,
        name: tokenMetadata.name,
        decimals: tokenMetadata.decimals,
        iconUrl: tokenMetadata.iconUrl || null,
        price: averagePrice,
        pools: poolsInfo,
        volume: volume24h,
        totalLiquidity: totalLiquidity,
        largestPool: poolsInfo.reduce((max, pool) =>
          (!isNaN(pool.liquidity) && pool.liquidity > max.liquidity) ? pool : max,
          { liquidity: 0 }
        )
      }
    };
  } catch (error) {
    return {
      success: false,
      token: tokenAddress,
      message: "Failed to fetch data from Cetus SDK",
      error: error.message
    };
  }
};