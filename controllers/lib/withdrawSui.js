import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import { SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { getFullnodeUrl } from '@mysten/sui.js/client';
import * as bip39 from 'bip39';
import { shorten } from "../../utils/shorten.js";
import { fetchUser } from "./db.js";
import { importWalletFromInput } from './importWallet.js';

export function decodeSuiPrivateKeyLocal(privateKey) {
    if (!privateKey.startsWith('suiprivkey1')) {
        throw new Error('Invalid Sui private key format');
    }

    try {
        // Use the imported decodeSuiPrivateKey from the SDK
        return decodeSuiPrivateKey(privateKey);
    } catch (error) {
        throw new Error(`Failed to decode Sui private key: ${error.message}`);
    }
}

export async function createWithdrawWalletKeyboard(userId) {
    const user = await fetchUser(userId);
    if (!user || !Array.isArray(user.wallets)) {
        return {
            inline_keyboard: [[{ text: "❌ No wallets found", callback_data: "withdraw_cancel" }]],
        };
    }

    const rows = user.wallets.map((wallet, index) => [
        { text: `🔐 ${wallet.name || "Wallet"} (${shorten(wallet.wallletAddress)})`, callback_data: `withdraw_wallet_${index}` },
    ]);

    rows.push([
        { text: "✅ Continue", callback_data: "confirm_withdraw" },
        { text: "❌ Cancel", callback_data: "cancel_withdraw" },
    ]);

    return { inline_keyboard: rows };
}


export function isValidSuiaddres(address) {
    return /^0x[a-fA-F0-9]{64}$/.test(address);
}

const CENTRON_BOT_VAULT_WALLET = process.env.CENTRON_BOT_VAULT_WALLET
const FEE_PERCENTAGE = Number(process.env.FEE_PERCENTAGE) || 0.01
// sending of sui to multiple wallet address
export async function sendSui(seedPhrase, toAddressParam, amountParam) {
    try {
        if (!seedPhrase) throw new Error("Missing wallet seed phrase or private key.");
        if (!toAddressParam) throw new Error("Missing recipient address.");
        if (!amountParam || typeof amountParam !== "number" || amountParam <= 0) {
            throw new Error(`Invalid amount: ${amountParam}`);
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
                // It's a mnemonic seed phrase
                keypair = Ed25519Keypair.deriveKeypair(privateKey, "m/44'/784'/0'/0'/0'");
                if (!keypair) throw new Error("🔑 Failed to derive keypair from mnemonic phrase.");
            } else if (privateKey.startsWith('suiprivkey1')) {
                // It's a Bech32 private key - use the correct method
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
                // Try to import using your existing function
                try {
                    const walletData = await importWalletFromInput(privateKey);
                    if (walletData.type === "Mnemonic") {
                        keypair = Ed25519Keypair.deriveKeypair(walletData.phrase, "m/44'/784'/0'/0'/0'");
                    } else {
                        // For other types, try different approaches
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

        const client = new SuiClient({ url: getFullnodeUrl("mainnet") });

        // --- Prepare Addresses & Amount ---
        const toAddresses = toAddressParam
            .split(",")
            .map((addr) => addr.trim())
            .filter(Boolean);
        if (toAddresses.length === 0) throw new Error("No valid recipient addresses provided.");

        // Calculate fee and net amount per recipient
        const feePerTransfer = amountParam * FEE_PERCENTAGE;
        const netAmountPerRecipient = amountParam - feePerTransfer;

        const feeAmountMist = BigInt(Math.round(feePerTransfer * 1e9)); // fee in mist
        const netAmountMist = BigInt(Math.round(netAmountPerRecipient * 1e9)); // net amount in mist

        const totalFeeAmountMist = feeAmountMist * BigInt(toAddresses.length);
        const totalNetAmountMist = netAmountMist * BigInt(toAddresses.length);
        const totalAmountMist = totalFeeAmountMist + totalNetAmountMist;

        // --- Check Balance ---
        const address = keypair.getPublicKey().toSuiAddress();
        const { data: ownedCoins } = await client.getCoins({
            owner: address,
            coinType: "0x2::sui::SUI",
        });

        if (!ownedCoins.length) throw new Error("No SUI coins found in wallet.");
        const availableBalance = ownedCoins.reduce((acc, coin) => acc + BigInt(coin.balance), 0n);

        // Need balance for transfers + gas + fee collection
        const requiredBalance = totalAmountMist + 10_000_000n; // Increased gas budget for additional operations
        if (availableBalance < requiredBalance) {
            throw new Error(`Insufficient balance. Required: ${Number(requiredBalance) / 1e9} SUI, Available: ${Number(availableBalance) / 1e9} SUI`);
        }

        // --- Build Transaction ---
        const tx = new TransactionBlock();

        // Create amounts array for recipients (net amounts)
        const netAmounts = toAddresses.map(() => tx.pure(netAmountMist));

        // Split coins for recipients
        const recipientSplit = tx.splitCoins(tx.gas, netAmounts);

        // Transfer net amounts to recipients
        toAddresses.forEach((address, i) => {
            tx.transferObjects([recipientSplit[i]], tx.pure(address));
        });

        // Handle fee collection - split the total fee amount for the fee receiver
        if (totalFeeAmountMist > 0n) {
            const feeAmount = tx.pure(totalFeeAmountMist);
            const feeCoin = tx.splitCoins(tx.gas, [feeAmount]);
            tx.transferObjects([feeCoin[0]], tx.pure(CENTRON_BOT_VAULT_WALLET));
        }

        tx.setGasBudget(10000000); // 0.01 SUI (increased for additional operations)

        const result = await client.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer: keypair,
            options: {
                showEffects: true,
                showEvents: true,
            },
        });

        const totalFeeCollected = Number(totalFeeAmountMist) / 1e9;
        const totalNetTransferred = Number(totalNetAmountMist) / 1e9;

        return {
            digest: result.digest,
            totalFeeCollected,
            totalNetTransferred,
            recipientCount: toAddresses.length,
            feePerTransfer,
            netAmountPerRecipient
        };
    } catch (error) {
        console.error("❌ Error in sendSui:", error.message);
        throw error;
    }
}