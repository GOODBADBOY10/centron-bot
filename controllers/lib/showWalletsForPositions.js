import { getFallbackTokenDetails } from "../../utils/getTokenDetails.js";
import { getUserPositions } from "./db.js";
import { fetchUser, saveUserStep } from "./db.js"
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import * as dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

const blockberryApiKey = process.env.BLOCKBERRYAPIKEY;

export async function showWalletsForPositions(ctx, userId) {
    try {
        const user = await fetchUser(userId);
        const allWallets = user.wallets || [];
        if (!allWallets.length) {
            return ctx.reply("❌ You haven't added any wallets yet.");
        }
        const walletButtons = [];
        const walletMap = {};
        allWallets.forEach((wallet, index) => {
            const address = wallet.address || wallet.walletAddress;
            const label = wallet.label || wallet.name || `${address.slice(0, 5)}...${address.slice(-4)}`;
            walletMap[`wallet_${index}`] = address;
            walletButtons.push({
                text: `💳 ${label}`,
                callback_data: `view_pos_idx_${index}`,
            });
        });
        const keyboard = [];
        for (let i = 0; i < walletButtons.length; i += 2) {
            keyboard.push(walletButtons.slice(i, i + 2));
        }
        keyboard.push([{ text: "← Main Menu", callback_data: "back_to_menu" }]);
        await saveUserStep(userId, {
            state: "awaiting_position_wallet",
            walletMap,
        });
        const messageText = `Choose a wallet to display active positions for:\n\n📘 <a href="https://example.com/help">How to Use?</a>`;

        await ctx.reply(messageText, {
            parse_mode: "HTML",
            disable_web_page_preview: false,
            reply_markup: { inline_keyboard: keyboard },
        });

        return true;
    } catch (e) {
        return ctx.reply("⚠️ Failed to load wallets.");
    }
}


export const getTokenPositions = async (userId, walletAddress, suiUsdPrice) => {
    const client = new SuiClient({ url: getFullnodeUrl("mainnet") });

    const balances = await client.getAllBalances({ owner: walletAddress });
    const filteredBalances = balances.filter(({ totalBalance }) => totalBalance !== "0");

    // 🧠 Fetch user positions just once!
    const userPositions = await getUserPositions(userId, walletAddress);

    // 🆕 Get ALL token prices from Blockberry in one call
    let blockberryData = [];
    let suiUsdPriceFromApi = suiUsdPrice; // Fallback to provided price

    try {
        const options = {
            method: 'GET',
            url: `https://api.blockberry.one/sui/v1/accounts/${walletAddress}/balance`,
            headers: {
                accept: '*/*',
                'x-api-key': blockberryApiKey,
            },
        };

        const res = await axios.request(options);
        blockberryData = res.data || [];

        // Get SUI price from Blockberry for consistency
        const suiToken = blockberryData.find(
            token => token.coinType?.toLowerCase() === '0x2::sui::sui'
        );

        if (suiToken) {
            suiUsdPriceFromApi = suiToken.coinPrice;
        }
    } catch (error) {
        console.warn('⚠️ Failed to fetch Blockberry data, using fallback method:', error.message);
    }

    const metadataCache = {};
    const fallbackCache = {};

    const tokenPositions = await Promise.all(
        filteredBalances.map(async ({ coinType, totalBalance }) => {
            try {
                // Use cached metadata
                let metadata = metadataCache[coinType];
                if (!metadata) {
                    metadata = await client.getCoinMetadata({ coinType });
                    metadataCache[coinType] = metadata;
                }

                const readableAmount = Number(totalBalance) / 10 ** (metadata.decimals || 9);

                // 🆕 Try to get price from Blockberry first
                let tokenInfo = {};
                let currentPriceSUI = 0;

                const blockberryToken = blockberryData.find(
                    token => token.coinType?.toLowerCase() === coinType.toLowerCase()
                );

                if (blockberryToken && suiUsdPriceFromApi > 0) {
                    // Calculate price in SUI terms using Blockberry data
                    const tokenUsdPrice = blockberryToken.coinPrice;
                    currentPriceSUI = tokenUsdPrice / suiUsdPriceFromApi;

                    tokenInfo = {
                        ...blockberryToken,
                        priceInSui: currentPriceSUI,
                        priceInUSD: tokenUsdPrice,
                        suiUsdPrice: suiUsdPriceFromApi,
                        source: 'blockberry'
                    };
                } else {
                    // Fallback to your existing method
                    let fallbackDetails = fallbackCache[coinType];
                    if (!fallbackDetails) {
                        fallbackDetails = await getFallbackTokenDetails(coinType, walletAddress);
                        fallbackCache[coinType] = fallbackDetails;
                    }

                    tokenInfo = fallbackDetails?.tokenInfo || {};
                    currentPriceSUI = tokenInfo.priceInSui || 0;
                    tokenInfo.source = 'fallback';
                }

                const stored = Array.isArray(userPositions)
                    ? userPositions.find(p => p.tokenAddress.toLowerCase() === coinType.toLowerCase())
                    : null;

                const avgEntrySUI = stored?.avgPriceSUI || 0;
                const avgEntryUsd = avgEntrySUI * suiUsdPriceFromApi;

                const currentValueSUI = readableAmount * currentPriceSUI;
                const totalCostSUI = avgEntrySUI * readableAmount;

                const currentValueUSD = currentValueSUI * suiUsdPriceFromApi;
                const totalCostUSD = totalCostSUI * suiUsdPriceFromApi;

                const pnlUsd = currentValueUSD - totalCostUSD;
                const pnlPercent = avgEntrySUI > 0
                    ? ((currentPriceSUI - avgEntrySUI) / avgEntrySUI) * 100
                    : 0;

                return {
                    coinType,
                    tokenAddress: coinType, // Add this for consistency
                    name: metadata.name,
                    symbol: metadata.symbol,
                    decimals: metadata.decimals,
                    rawBalance: totalBalance,
                    readableBalance: readableAmount,
                    avgEntrySUI,
                    avgEntryUsd,
                    currentPriceSUI,
                    totalCostSUI,
                    totalCostUSD,
                    valueSUI: currentValueSUI,
                    valueUSD: currentValueUSD,
                    pnlUsd,
                    pnlPercent,
                    tokenInfo
                };
            } catch (err) {
                console.warn(`⚠️ Failed to fetch details for ${coinType}`, err);
                return null;
            }
        })
    );
    return tokenPositions.filter(Boolean);
};


export async function handlePositionsWalletList(ctx, userId) {
    const user = await fetchUser(userId);
    const wallets = user?.wallets || [];

    if (wallets.length === 0) {
        return ctx.reply("😕 You don’t have any wallets yet.");
    }

    const inline_keyboard = [];
    let index = 0;

    for (let i = 0; i < wallets.length; i += 2) {
        const row = [];

        for (let j = 0; j < 2 && i + j < wallets.length; j++) {
            const wallet = wallets[i + j];
            const shortAddress = wallet.walletAddress.slice(0, 6) + "..." + wallet.walletAddress.slice(-4);
            const name = wallet.name || shortAddress;

            row.push({
                text: `💳 ${name}`,
                callback_data: `view_pos_idx_${index}`
            });

            index++;
        }

        inline_keyboard.push(row);
    }

    const messageText = `Choose a wallet to display active positions for:\n\n📘 <a href="https://example.com/help">How to Use?</a>`;

    return ctx.editMessageText(messageText, {
        parse_mode: "HTML",
        disable_web_page_preview: false,
        reply_markup: { inline_keyboard }
    });
}