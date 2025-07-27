import { Aftermath } from "aftermath-ts-sdk";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSlippage } from "./slippage.js";

const FEE_RECEIVER_ADDRESS = process.env.FEE_WALLET_ADDRESS;

async function fetchWithRetry(client, tokenAddress, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const metadata = await client.getCoinMetadata({ coinType: tokenAddress });
      return metadata;
    } catch (e) {
      console.warn(`Metadata fetch failed (attempt ${i + 1}):`, e.message);
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
    }
  }
}

export const buyTokenWithAftermath = async ({ tokenAddress, phrase, suiAmount, slippage }) => {
  try {
    if (!tokenAddress || !phrase || !suiAmount || !slippage) {
      throw new Error("Missing required parameters");
    }

    if (slippage < 0 || slippage > 100) {
      throw new Error("Slippage must be between 0 and 100");
    }

    const client = new SuiClient({
      url: getFullnodeUrl("mainnet")
    });

    const afsdk = new Aftermath("MAINNET");
    await afsdk.init();
    const router = afsdk.Router();
    const keyPair = Ed25519Keypair.deriveKeypair(phrase);
    const walletAddress = keyPair.getPublicKey().toSuiAddress();

    const balances = await client.getAllBalances({ owner: walletAddress });
    const suiBalanceObj = balances.find(balance => balance.coinType === "0x2::sui::SUI");
    const suiBalance = suiBalanceObj ? BigInt(suiBalanceObj.totalBalance) : 0n;

    const buffer = 5_000_000n;
    if (suiBalance < BigInt(suiAmount) + buffer) {
      throw new Error("Insufficient SUI balance (including buffer for gas fees)");
    }

    let route;
    try {
      route = await router.getCompleteTradeRouteGivenAmountIn({
        coinInType: '0x2::sui::SUI',
        coinOutType: tokenAddress,
        coinInAmount: BigInt(suiAmount),
      });
    } catch (e) {
      throw new Error("❌ Failed to find swap route. Possibly unsupported token or too low amount.");
    }

    if (!route || !route.routes?.length) {
      throw new Error("No viable trade route found.");
    }

    const txBlock = await router.getTransactionForCompleteTradeRoute({
      walletAddress,
      completeRoute: route,
      slippage: normalizeSlippage(slippage)
    });

    const result = await client.signAndExecuteTransaction({
      signer: keyPair,
      transaction: txBlock,
    });

    const allBalances = await client.getAllBalances({ owner: walletAddress });
    const tokenBalanceObj = allBalances.find(b => b.coinType === tokenAddress);
    const tokenAmountReceived = tokenBalanceObj ? BigInt(tokenBalanceObj.totalBalance) : 0n;

    // Fetch token metadata
    let symbol = "UNKNOWN";
    let decimals = 9;
    try {
      const metadata = await fetchWithRetry(client, tokenAddress);
      if (!metadata || metadata.decimals === undefined) {
        throw new Error('⚠️ Failed to fetch token metadata');
      }
      symbol = metadata.symbol || symbol;
      decimals = metadata.decimals || decimals;
    } catch (err) {
      console.warn("⚠️ Token metadata error:", err.message);
    }

    const tokenAmountReadable = Number(tokenAmountReceived) / (10 ** decimals);

    return {
      success: true,
      transactionDigest: result.digest,
      walletAddress,
      spentSUI: Number(suiAmount) / 1e9,
      tokenAmountReceived: Number(tokenAmountReceived),
      tokenAmountReadable,
      tokenSymbol: symbol,
      tokenAddress,
      decimals,
    };
  } catch (error) {
    throw error;
  }
};

export const sellTokenWithAftermath = async ({ tokenAddress, phrase, suiPercentage, slippage }) => {
  try {
    if (!tokenAddress || !phrase || !suiPercentage || !slippage) {
      throw new Error("Missing required parameters");
    }
    const client = new SuiClient({
      url: getFullnodeUrl("mainnet")
    });

    const afsdk = new Aftermath("MAINNET");
    await afsdk.init();
    const router = afsdk.Router();
    const keyPair = Ed25519Keypair.deriveKeypair(phrase);
    const walletAddress = keyPair.getPublicKey().toSuiAddress();

    const balances = await client.getAllBalances({
      owner: walletAddress
    });

    // Find token balance (not SUI!)
    const tokenBalanceObj = balances.find(b => b.coinType === tokenAddress);
    const totalBalance = tokenBalanceObj ? BigInt(tokenBalanceObj.totalBalance) : 0n;

    if (totalBalance === 0n) {
      throw new Error("You have no balance of this token to sell.");
    }

    const tokenAmount = (totalBalance * BigInt(suiPercentage)) / 100n;

    if (tokenAmount === 0n) {
      throw new Error("Token amount to sell is too small.");
    }

    // Execute swap
    let route;
    try {
      route = await router.getCompleteTradeRouteGivenAmountIn({
        coinInType: tokenAddress,
        coinOutType: '0x2::sui::SUI',
        coinInAmount: tokenAmount,
      });
    } catch (e) {
      throw new Error("Failed to find swap route. Possibly due to low liquidity or unsupported token pair.");
    }

    const txBlock = await router.getTransactionForCompleteTradeRoute({
      walletAddress,
      completeRoute: route,
      slippage: normalizeSlippage(slippage),
    });

    const result = await client.signAndExecuteTransaction({
      signer: keyPair,
      transaction: txBlock,
    });

    const { symbol, decimals } = await getTokenMetadataSafe(client, tokenAddress);

    const tokenAmountReadable = Number(tokenAmount) / (10 ** decimals);

    return {
      success: true,
      txDigest: result.digest,
      walletAddress,
      tokenAddress,
      tokenAmountReadable,
      tokenAmountReceived: Number(tokenAmount),
      spentSUI: Number(route.estimatedAmountOut) / 1e9,
      tokenSymbol: symbol,
    };
  } catch (error) {
    throw error;
  }
};

async function getTokenMetadataSafe(client, tokenAddress) {
  try {
    const metadata = await fetchWithRetry(client, tokenAddress);
    return {
      symbol: metadata?.symbol || "UNKNOWN",
      decimals: metadata?.decimals ?? 9
    };
  } catch {
    return { symbol: "UNKNOWN", decimals: 9 };
  }
}