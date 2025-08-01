import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Aftermath } from "aftermath-ts-sdk";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSlippage } from "./slippage.js";
import { Transaction } from "@mysten/sui/transactions";
import { getKeypairFromInput } from "../lib/getKeypairFromInput.js";

const CENTRON_BOT_VAULT_WALLET = process.env.CENTRON_BOT_VAULT_WALLET

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
  let feeTransactionDigest = null;

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
    const keyPair = await getKeypairFromInput(phrase);
    const walletAddress = keyPair.getPublicKey().toSuiAddress();

    const balances = await client.getAllBalances({ owner: walletAddress });
    const suiBalanceObj = balances.find(balance => balance.coinType === "0x2::sui::SUI");
    const suiBalance = suiBalanceObj ? BigInt(suiBalanceObj.totalBalance) : 0n;

    const buffer = 10_000_000n; // 0.01 SUI buffer for gas (increased)
    const feeAmount = BigInt(suiAmount) / 100n; // 1%
    const tradeAmount = BigInt(suiAmount) - feeAmount;

    const totalRequired = feeAmount + tradeAmount + buffer;
    if (suiBalance < totalRequired) {
      throw new Error("Insufficient SUI balance (including gas + fee)");
    }

    // First check if the route exists before taking fees
    let route;
    try {
      route = await router.getCompleteTradeRouteGivenAmountIn({
        coinInType: '0x2::sui::SUI',
        coinOutType: tokenAddress,
        coinInAmount: tradeAmount,
      });
    } catch (e) {
      console.error("⚠️ Route error:", e.message || e);
      throw new Error("❌ Failed to find swap route. Possibly unsupported token or too low amount.");
    }

    if (!route || !route.routes?.length) {
      throw new Error("No viable trade route found.");
    }

    // STEP 1: Send 1% fee to your wallet
    const feeTx = new Transaction()
    const [feeCoin] = feeTx.splitCoins(feeTx.gas, [feeAmount]);
    feeTx.transferObjects([feeCoin], CENTRON_BOT_VAULT_WALLET);

    const feeResult = await client.signAndExecuteTransaction({
      signer: keyPair,
      transaction: feeTx,
      options: {
        showEffects: true,
        showObjectChanges: true,
      }
    });

    feeTransactionDigest = feeResult.digest;

    // STEP 2: Execute token trade
    const txBlock = await router.getTransactionForCompleteTradeRoute({
      walletAddress,
      completeRoute: route,
      slippage: normalizeSlippage(slippage)
    });

    const result = await client.signAndExecuteTransaction({
      signer: keyPair,
      transaction: txBlock,
      options: {
        showEffects: true,
        showObjectChanges: true,
      }
    });

    // Wait for balances to update
    await new Promise(resolve => setTimeout(resolve, 2000));

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
      feeTransactionDigest,
      walletAddress,
      spentSUI: Number(tradeAmount) / 1e9,
      tokenAmountReceived: Number(tokenAmountReceived),
      tokenAmountReadable,
      tokenSymbol: symbol,
      tokenAddress,
      decimals,
      feePaid: Number(feeAmount) / 1e9,
      feeRecipient: CENTRON_BOT_VAULT_WALLET,
    };
  } catch (error) {
    console.error('Buy token error:', error);

    // If fee was taken but trade failed, include that info
    if (feeTransactionDigest) {
      error.feeTransactionDigest = feeTransactionDigest;
      error.message = `Trade failed but fee was already taken. Fee TX: ${feeTransactionDigest}. Error: ${error.message}`;
    }

    throw error;
  }
};

export const sellTokenWithAftermath = async ({ tokenAddress, phrase, suiPercentage, slippage }) => {
  try {
    if (!tokenAddress || !phrase || !suiPercentage || !slippage) {
      throw new Error("Missing required parameters");
    }

    if (slippage < 0 || slippage > 100) {
      throw new Error("Slippage must be between 0 and 100");
    }

    if (suiPercentage <= 0 || suiPercentage > 100) {
      throw new Error("Percentage must be between 1 and 100");
    }

    if (!CENTRON_BOT_VAULT_WALLET) {
      throw new Error("Fee receiver address not configured");
    }

    const client = new SuiClient({
      url: getFullnodeUrl("mainnet")
    });

    const afsdk = new Aftermath("MAINNET");
    await afsdk.init();
    const router = afsdk.Router();
    const keyPair = await getKeypairFromInput(phrase);
    const walletAddress = keyPair.getPublicKey().toSuiAddress();

    const balances = await client.getAllBalances({ owner: walletAddress });
    const tokenBalanceObj = balances.find(b => b.coinType === tokenAddress);
    const totalBalance = tokenBalanceObj ? BigInt(tokenBalanceObj.totalBalance) : 0n;

    if (totalBalance === 0n) {
      throw new Error("You have no balance of this token to sell.");
    }

    const tokenAmount = (totalBalance * BigInt(suiPercentage)) / 100n;
    if (tokenAmount === 0n) {
      throw new Error("Token amount to sell is too small.");
    }

    // Get expected SUI output to calculate fee beforehand
    let route;
    try {
      route = await router.getCompleteTradeRouteGivenAmountIn({
        coinInType: tokenAddress,
        coinOutType: '0x2::sui::SUI',
        coinInAmount: tokenAmount,
      });
    } catch (e) {
      console.error("Route error:", e.message || e);
      throw new Error("Failed to find swap route for this token.");
    }

    if (!route || !route.routes?.length) {
      throw new Error("No viable trade route found for this token.");
    }

    // Calculate expected output and fee
    const expectedSuiOutput = BigInt(route.coinOut.amount);
    const feeAmount = expectedSuiOutput / 100n; // 1% of expected output
    const expectedUserSui = expectedSuiOutput - feeAmount;

    // Execute the swap
    const txBlock = await router.getTransactionForCompleteTradeRoute({
      walletAddress,
      completeRoute: route,
      slippage: normalizeSlippage(slippage),
    });

    const result = await client.signAndExecuteTransaction({
      signer: keyPair,
      transaction: txBlock,
      options: {
        showEffects: true,
        showObjectChanges: true,
      }
    });

    // Wait for balances to update
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get actual SUI received
    const updatedBalances = await client.getAllBalances({ owner: walletAddress });
    const suiBalanceObj = updatedBalances.find(b => b.coinType === '0x2::sui::SUI');
    const actualSuiBalance = suiBalanceObj ? BigInt(suiBalanceObj.totalBalance) : 0n;

    // Calculate actual fee based on what we received (with minimum check)
    const actualFeeAmount = actualSuiBalance >= feeAmount ? feeAmount : actualSuiBalance / 100n;

    if (actualFeeAmount > 0n) {
      const feeTx = new Transaction();
      const [feeCoin] = feeTx.splitCoins(feeTx.gas, [actualFeeAmount]);
      feeTx.transferObjects([feeCoin], CENTRON_BOT_VAULT_WALLET);

      await client.signAndExecuteTransaction({
        signer: keyPair,
        transaction: feeTx,
        options: {
          showEffects: true,
          showObjectChanges: true,
        }
      });
    }
    const tokenSymbol = tokenAddress.split("::")[2];

    const finalUserSui = actualSuiBalance - actualFeeAmount;

    return {
      success: true,
      transactionDigest: result.digest,
      walletAddress,
      tokenAmountSold: Number(tokenAmount),
      tokenAddress,
      expectedSuiOutput: Number(expectedSuiOutput) / 1e9,
      actualSuiReceived: Number(actualSuiBalance) / 1e9,
      suiAfterFee: Number(finalUserSui) / 1e9,
      feePaid: Number(actualFeeAmount) / 1e9,
      feeRecipient: CENTRON_BOT_VAULT_WALLET,
      percentageSold: suiPercentage,
      tokenSymbol
    };
  } catch (error) {
    console.error('Sell token error:', error);
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