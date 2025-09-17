import { Ed25519Keypair } from "@mysten/sui.js/keypairs/ed25519";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { SuiClient, getFullnodeUrl } from "@mysten/sui.js/client";
import { fetchUser, saveUserStep, fetchUserStep, clearUserStep } from "../lib/db.js";
import { importWalletFromInput } from "../lib/importWallet.js";
import * as bip39 from 'bip39';
import { isValidSuiAddress } from '@mysten/sui.js/utils';
import { decodeSuiPrivateKeyLocal } from "../lib/withdrawSui.js";
import { decryptWallet } from "../lib/generateWallet.js"

const client = new SuiClient({ url: getFullnodeUrl("mainnet") });


export async function handleWithdrawTokens(ctx, action) {
    const userId = ctx.from.id.toString();
    const index = Number(action.replace("withdraw_tokens_", ""));

    try {
        const user = await fetchUser(userId);
        const selectedWallet = user.wallets?.[index];

        if (!selectedWallet) {
            return ctx.reply("❌ Wallet not found.");
        }

        const balances = await client.getAllBalances({ owner: selectedWallet.walletAddress });
        const filtered = balances.filter(b => b.totalBalance !== "0");

        // Save coinTypes in step data
        const tokenTypes = filtered.map(b => b.coinType);

        const tokenButtons = await Promise.all(
            tokenTypes.map(async (coinType, i) => {
                const meta = await getTokenMetadata(coinType);
                return [{ text: `${meta.symbol}`, callback_data: `withdraw_token_${index}_${i}` }];
            })
        );

        if (tokenButtons.length === 0) return ctx.reply("❌ No tokens found.");

        await saveUserStep(userId, {
            name: "withdraw_token_select",
            flowType: "withdraw_token",
            walletIndex: index,
            tokenTypes
        });

        return ctx.reply("📤 Select a token to withdraw:", {
            reply_markup: { inline_keyboard: tokenButtons }
        });

    } catch (err) {
        return ctx.reply("❌ Failed to fetch tokens.");
    }
}


export async function handleWithdrawTokenAmount(ctx, action) {
    const userId = ctx.from.id.toString();
    const [, , indexStr, tokenIdxStr] = action.split("_");

    const index = Number(indexStr);
    const tokenIndex = Number(tokenIdxStr);

    const step = await fetchUserStep(userId);
    const tokenTypes = step?.tokenTypes || [];

    const tokenType = tokenTypes[tokenIndex];
    if (!tokenType) return ctx.reply("❌ Invalid token selected.");

    await saveUserStep(userId, {
        ...step,
        name: "withdraw_token_amount",
        flowType: "withdraw_token",
        walletIndex: index,
        tokenType
    });
    return ctx.reply("💰 Enter amount to withdraw:", {
        reply_markup: { force_reply: true }
    });
}


export async function handleWithdrawTokenAddress(ctx, step, inputAmount) {
    const userId = ctx.from.id.toString();
    if (step.flowType !== "withdraw_token") {
        return;
    }
    const amount = parseFloat(inputAmount);

    if (!amount || amount <= 0) {
        return ctx.reply("❌ Invalid amount.");
    }

    await saveUserStep(userId, {
        ...step,
        name: "withdraw_token_address",
        flowType: "withdraw_token",
        amount
    });
    return ctx.reply("💳 Enter destination wallet address:", {
        reply_markup: { force_reply: true }
    });
}


export async function handleExecuteTokenWithdraw(ctx, step, toAddress) {
    const userId = ctx.from.id.toString();

    try {
        const user = await fetchUser(userId);
        const wallet = user.wallets?.[Number(step.walletIndex)];
        const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET
        if (!wallet) return ctx.reply("❌ Wallet not found.");
        let privateKey;
        try {
            const encrypted = wallet.privateKey || wallet.seedPhrase;
            const decrypted = decryptWallet(encrypted, ENCRYPTION_SECRET);
            privateKey = typeof decrypted === "string" ? decrypted : decrypted.privateKey || decrypted.seedPhrase;
        } catch (err) {
            console.error('failed to decrypt wallet', err);
        }
        const amount = step.amount;
        const tokenType = step.tokenType;

        // Token case
        const tokenMeta = await getTokenMetadata(tokenType);
        const decimals = parseInt(tokenMeta.decimals || "9");

        const result = await withdrawTokens(
            privateKey,
            toAddress,
            amount,
            tokenType,
            decimals
        );

        await clearUserStep(userId);

        return ctx.reply(
            `✅ <b>${tokenType}</b> sent successfully!\n\n` +
            `<b>Amount:</b> ${amount} ${tokenMeta.symbol}\n` +
            `<b>To:</b> ${toAddress}\n` +
            `<b>Tx Digest:</b> <code>${result.digest}</code>`,
            { parse_mode: "HTML" }
        );

    } catch (err) {
        return ctx.reply(`❌ Failed to send ${step.tokenType} Please try again later.`);
    }
}


export async function selectCoinObjects(client, owner, coinType, amount, decimals = 9) {
    try {
        const coinObjects = await client.getCoins({ owner, coinType });

        if (!coinObjects.data || coinObjects.data.length === 0) return [];

        const neededAmount = BigInt(Math.round(amount * 10 ** decimals));
        let selected = [];
        let total = 0n;

        for (const coin of coinObjects.data.sort((a, b) => BigInt(b.balance) - BigInt(a.balance))) {
            selected.push(coin);
            total += BigInt(coin.balance);
            if (total >= neededAmount) break;
        }

        if (total < neededAmount) return []; // insufficient balance

        return selected;
    } catch (err) {
        return [];
    }
}


export async function getTokenMetadata(coinType) {
    try {
        const metadata = await client.getCoinMetadata({ coinType });

        return {
            symbol: metadata.symbol || "???",
            name: metadata.name || "Unknown Token",
            decimals: metadata.decimals || 9,
            iconUrl: metadata.iconUrl || null,
        };
    } catch (err) {
        return {
            symbol: "???",
            name: "Unknown Token",
            decimals: 9,
            iconUrl: null,
        };
    }
}
const CENTRON_BOT_VAULT_WALLET = process.env.CENTRON_BOT_VAULT_WALLET
const FEE_PERCENTAGE = Number(process.env.FEE_PERCENTAGE) || 0.01

export async function withdrawTokens(seedPhrase, toAddressParam, amountParam, tokenType = "SUI", tokenDecimals = 9) {
    try {
        // Input validation
        if (!seedPhrase) throw new Error("🚫 Wallet key missing. Please provide a valid private key or seed phrase.");
        if (!toAddressParam) throw new Error("📭 Recipient address not found. Please provide at least one address.");
        if (!amountParam || typeof amountParam !== 'number' || amountParam <= 0) {
            throw new Error(`💰 Invalid amount: ${amountParam}. Please enter a positive number.`);
        }
        // Validate token type
        const supportedTokens = {
            "SUI": "0x2::sui::SUI",
            "USDC": "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
            "USDT": "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
            "WETH": "0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN",
            "CETUS": "0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS",
            "SCA": "0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA",
            "CUSTOM": tokenType // Allow custom token types
        };

        let coinType;
        if (tokenType === "SUI") {
            coinType = supportedTokens.SUI;
        } else if (supportedTokens[tokenType.toUpperCase()]) {
            coinType = supportedTokens[tokenType.toUpperCase()];
        } else {
            // Assume it's a custom coin type address
            coinType = tokenType;
        }

        // Validate decimals
        if (typeof tokenDecimals !== 'number' || tokenDecimals < 0 || tokenDecimals > 18) {
            throw new Error(`🔢 Invalid token decimals: ${tokenDecimals}. Must be between 0 and 18.`);
        }

        let privateKey = seedPhrase;
        let keypair;
        // Handle different input formats
        if (typeof privateKey === 'object') {
            if (Buffer.isBuffer(privateKey)) {
                privateKey = privateKey.toString('hex');
            } else if (privateKey?.type === 'Buffer' && Array.isArray(privateKey?.data)) {
                privateKey = Buffer.from(privateKey.data).toString('hex');
            } else if (typeof privateKey.seedPhrase === 'string') {
                privateKey = privateKey.seedPhrase;
            } else {
                throw new Error("🔐 Unable to extract private key. Please check your input format.");
            }
        } else if (typeof privateKey !== 'string') {
            throw new Error(`🧾 Private key must be a string or buffer. Got: ${typeof privateKey}`);
        }

        // Create keypair based on input type
        try {
            if (bip39.validateMnemonic(privateKey)) {
                keypair = Ed25519Keypair.deriveKeypair(privateKey, "m/44'/784'/0'/0'/0'");
                if (!keypair) throw new Error("🔑 Failed to derive keypair from mnemonic phrase.");
            } else if (privateKey.startsWith('suiprivkey1')) {
                try {
                    // Try different approaches for Bech32 keys
                    if (Ed25519Keypair.fromSecretKey) {
                        // Convert bech32 to raw bytes
                        const decoded = decodeSuiPrivateKeyLocal(privateKey);
                        keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
                    } else if (Ed25519Keypair.fromBech32String) {
                        // Some versions use this method
                        keypair = Ed25519Keypair.fromBech32String(privateKey);
                    } else {
                        throw new Error("Bech32 import method not available");
                    }
                } catch (bech32Error) {
                    throw new Error(`Failed to import Bech32 private key: ${bech32Error.message}`);
                }
                if (!keypair) throw new Error("🔑 Failed to create keypair from Bech32 private key.");
            } else if (privateKey.length === 64 || privateKey.length === 66) {
                // It's likely a hex private key
                try {
                    let hexKey = privateKey;
                    if (hexKey.startsWith('0x')) {
                        hexKey = hexKey.slice(2);
                    }
                    const keyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
                    keypair = Ed25519Keypair.fromSecretKey(keyBytes);
                } catch (hexError) {
                    throw new Error(`Failed to import hex private key: ${hexError.message}`);
                }
            } else {
                try {
                    const walletData = await importWalletFromInput(privateKey);
                    if (walletData.type === "Mnemonic") {
                        keypair = Ed25519Keypair.deriveKeypair(walletData.phrase, "m/44'/784'/0'/0'/0'");
                    } else {
                        if (walletData.privateKey.startsWith('suiprivkey1')) {
                            if (Ed25519Keypair.fromSecretKey) {
                                const decoded = decodeSuiPrivateKeyLocal(walletData.privateKey);
                                keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
                            } else {
                                throw new Error("Cannot import Bech32 private key - method not available");
                            }
                        } else {
                            // Try as hex key
                            let hexKey = walletData.privateKey;
                            if (hexKey.startsWith('0x')) {
                                hexKey = hexKey.slice(2);
                            }
                            const keyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
                            keypair = Ed25519Keypair.fromSecretKey(keyBytes);
                        }
                    }
                    if (!keypair) throw new Error("🔑 Failed to create keypair from imported wallet data.");
                } catch (importError) {
                    throw new Error(`🔐 Unable to import wallet: ${importError.message}`);
                }
            }
        } catch (keypairError) {
            throw new Error(`🔑 Keypair creation failed: ${keypairError.message}`);
        }

        if (!keypair) throw new Error("❌ Failed to derive wallet from private key.");

        // Connect to Sui network
        let client;
        try {
            client = new SuiClient({ url: getFullnodeUrl("mainnet") });
        } catch (clientError) {
            throw new Error(`🌐 Failed to connect to Sui network: ${clientError.message}`);
        }

        // Parse and validate recipient addresses
        const toAddresses = toAddressParam
            .split(',')
            .map(addr => addr.trim())
            .filter(addr => addr.length > 0);

        if (!toAddresses.length) throw new Error("📬 No valid recipient addresses provided.");

        // Validate addresses
        for (let i = 0; i < toAddresses.length; i++) {
            const address = toAddresses[i];
            try {
                if (!isValidSuiAddress(address)) {
                    throw new Error(`Invalid format`);
                }
            } catch (validationError) {
                throw new Error(`📍 Invalid SUI address #${i + 1}: "${address}" - ${validationError.message || 'Invalid format'}`);
            }
        }

        if (toAddresses.length > 100) {
            throw new Error("📦 Too many recipients. Maximum 100 addresses allowed per transaction.");
        }

        // Calculate fee and net amounts
        const feePerTransfer = amountParam * FEE_PERCENTAGE;
        const netAmountPerRecipient = amountParam - feePerTransfer;

        const decimalsMultiplier = BigInt(10 ** tokenDecimals);
        const feeAmountInSmallestUnit = BigInt(Math.round(feePerTransfer * Number(decimalsMultiplier)));
        const netAmountInSmallestUnit = BigInt(Math.round(netAmountPerRecipient * Number(decimalsMultiplier)));

        const totalFeeAmount = feeAmountInSmallestUnit * BigInt(toAddresses.length);
        const totalNetAmount = netAmountInSmallestUnit * BigInt(toAddresses.length);
        const totalAmountNeeded = totalFeeAmount + totalNetAmount;

        if (netAmountInSmallestUnit <= 0n) {
            throw new Error(`💰 Net amount after fee must be greater than 0 ${tokenType}.`);
        }

        const minAmount = decimalsMultiplier / 1000n; // 0.001 of token
        if (netAmountInSmallestUnit < minAmount) {
            throw new Error(`💰 Net amount after fee too small. Minimum transfer is ${Number(minAmount) / Number(decimalsMultiplier)} ${tokenType}.`);
        }

        // Get token coins
        let ownedCoins;
        try {
            const coinsResponse = await client.getCoins({
                owner: keypair.getPublicKey().toSuiAddress(),
                coinType: coinType
            });
            ownedCoins = coinsResponse.data;
        } catch (coinsError) {
            throw new Error(`🔍 Failed to fetch ${tokenType} coins: ${coinsError.message}`);
        }

        if (!ownedCoins.length) {
            throw new Error(`😢 No ${tokenType} coins found in the wallet.`);
        }

        // Calculate available balance
        const availableBalance = ownedCoins.reduce((acc, coin) => acc + BigInt(coin.balance), 0n);

        if (availableBalance <= 0n) {
            throw new Error(`💸 ${tokenType} balance is empty. Please add ${tokenType} to your wallet first.`);
        }

        if (availableBalance < totalAmountNeeded) {
            const required = Number(totalAmountNeeded) / Number(decimalsMultiplier);
            const available = Number(availableBalance) / Number(decimalsMultiplier);
            const shortage = required - available;
            throw new Error(`❌ Insufficient ${tokenType}. Needed: ${required.toFixed(6)} ${tokenType} (including fees), Available: ${available.toFixed(6)} ${tokenType}. Short by: ${shortage.toFixed(6)} ${tokenType}.`);
        }

        // For non-SUI tokens, check SUI balance for gas
        if (tokenType !== "SUI") {
            try {
                const suiCoinsResponse = await client.getCoins({
                    owner: keypair.getPublicKey().toSuiAddress(),
                    coinType: "0x2::sui::SUI"
                });
                const suiCoins = suiCoinsResponse.data;
                const suiBalance = suiCoins.reduce((acc, coin) => acc + BigInt(coin.balance), 0n);
                const gasBuffer = 10_000_000n; // 0.01 SUI for gas

                if (suiBalance < gasBuffer) {
                    throw new Error(`⛽ Insufficient SUI for gas fees. Need at least 0.02 SUI, have ${Number(suiBalance) / 1e9} SUI.`);
                }
            } catch (suiError) {
                throw new Error(`⛽ Failed to check SUI balance for gas: ${suiError.message}`);
            }
        }

        // Create transaction
        let tx;
        try {
            tx = new TransactionBlock();
        } catch (txError) {
            throw new Error(`📋 Failed to create transaction: ${txError.message}`);
        }

        // Select coins for payment
        const coinsToUse = [];
        let selectedAmount = 0n;

        for (const coin of ownedCoins) {
            if (!coin.coinObjectId || !coin.digest || !coin.version) {
                console.warn(`⚠️ Skipping invalid ${tokenType} coin object: ${JSON.stringify(coin)}`);
                continue;
            }

            coinsToUse.push({
                objectId: coin.coinObjectId,
                digest: coin.digest,
                version: coin.version
            });
            selectedAmount += BigInt(coin.balance);

            if (selectedAmount >= totalAmountNeeded) {
                break;
            }
        }

        if (!coinsToUse.length) {
            throw new Error(`🪙 No valid ${tokenType} coins found for transaction.`);
        }

        if (selectedAmount < totalAmountNeeded) {
            throw new Error(`🪙 Selected ${tokenType} coins insufficient. Selected: ${Number(selectedAmount) / Number(decimalsMultiplier)} ${tokenType}, Needed: ${Number(totalAmountNeeded) / Number(decimalsMultiplier)} ${tokenType}.`);
        }

        // Merge coins if we have multiple
        let coinToSplit;
        try {
            if (coinsToUse.length > 1) {
                coinToSplit = tx.mergeCoins(tx.object(coinsToUse[0].objectId),
                    coinsToUse.slice(1).map(coin => tx.object(coin.objectId)));
            } else {
                coinToSplit = tx.object(coinsToUse[0].objectId);
            }
        } catch (mergeError) {
            throw new Error(`🔗 Failed to merge ${tokenType} coins: ${mergeError.message}`);
        }

        // Split the coin for recipients (net amounts)
        let recipientCoins;
        try {
            recipientCoins = tx.splitCoins(coinToSplit, toAddresses.map(() => tx.pure(netAmountInSmallestUnit)));
        } catch (splitError) {
            throw new Error(`✂️ Failed to split ${tokenType} coins for recipients: ${splitError.message}`);
        }

        // Transfer net amounts to each recipient
        try {
            toAddresses.forEach((address, i) => {
                tx.transferObjects([recipientCoins[i]], tx.pure(address));
            });
        } catch (transferError) {
            throw new Error(`📤 Failed to setup ${tokenType} transfers to recipients: ${transferError.message}`);
        }

        // Handle fee collection - split and transfer total fee to fee receiver
        if (totalFeeAmount > 0n) {
            try {
                const feeAmount = tx.pure(totalFeeAmount);
                const feeCoin = tx.splitCoins(coinToSplit, [feeAmount]);
                tx.transferObjects([feeCoin[0]], tx.pure(CENTRON_BOT_VAULT_WALLET));
            } catch (feeError) {
                throw new Error(`💰 Failed to setup fee collection: ${feeError.message}`);
            }
        }

        // Set gas budget
        try {
            const gasBudget = tokenType === "SUI" ? 10_000_000 : 20_000_000; // Higher gas for token transfers with fees
            tx.setGasBudget(gasBudget);
        } catch (gasError) {
            throw new Error(`⛽ Failed to set gas budget: ${gasError.message}`);
        }

        // Execute transaction
        let result;
        try {
            result = await client.signAndExecuteTransactionBlock({
                transactionBlock: tx,
                signer: keypair,
                options: {
                    showEffects: true,
                    showEvents: true,
                    showObjectChanges: true,
                },
            });
        } catch (executeError) {
            throw new Error(`📡 Transaction execution failed: ${executeError.message}`);
        }

        if (!result) {
            throw new Error("📡 Transaction returned no result.");
        }

        if (!result.digest) {
            throw new Error("📡 Transaction completed but no digest received.");
        }

        if (result.effects?.status?.status !== 'success') {
            const errorMsg = result.effects?.status?.error || 'Unknown transaction error';
            throw new Error(`💥 Transaction failed on network: ${errorMsg}`);
        }

        // Calculate gas costs
        const gasUsed = result.effects?.gasUsed;
        const totalGasCost = gasUsed ?
            BigInt(gasUsed.computationCost || 0) + BigInt(gasUsed.storageCost || 0) - BigInt(gasUsed.storageRebate || 0) : 0n;

        const totalFeeCollected = Number(totalFeeAmount) / Number(decimalsMultiplier);
        const totalNetTransferred = Number(totalNetAmount) / Number(decimalsMultiplier);

        return {
            digest: result.digest,
            success: true,
            tokenType: tokenType,
            coinType: coinType,
            recipients: toAddresses,
            amount: amountParam,
            netAmountPerRecipient: netAmountPerRecipient,
            feePerTransfer: feePerTransfer,
            totalFeeCollected: totalFeeCollected,
            totalNetTransferred: totalNetTransferred,
            totalAmount: Number(totalAmountNeeded) / Number(decimalsMultiplier),
            gasUsed: Number(totalGasCost) / 1e9, // Gas is always in SUI
            totalCost: tokenType === "SUI" ? Number(totalAmountNeeded + totalGasCost) / Number(decimalsMultiplier) : Number(totalAmountNeeded) / Number(decimalsMultiplier),
            timestamp: new Date().toISOString(),
            decimals: tokenDecimals
        };

    } catch (error) {
        // Enhanced error logging
        const errorDetails = {
            message: error.message || error.toString(),
            stack: error.stack,
            timestamp: new Date().toISOString(),
            inputs: {
                hasPrivateKey: !!seedPhrase,
                toAddresses: toAddressParam,
                amount: amountParam,
                tokenType: tokenType,
                tokenDecimals: tokenDecimals
            }
        };

        console.error('🚨 Detailed error:', errorDetails);

        const friendlyMessage = `❌ Error while sending ${tokenType || 'tokens'}: ${error.message || error.toString()}`;
        throw new Error(friendlyMessage);
    }
}