import { formatBigNumber, getCoinBalance, withTimeout } from "../../utils/getTokenDetails.js";
import { getBalance } from "./getBalance.js";
import { shortAddress } from "./shortAddress.js";
import { fetchUserStep, saveUserStep } from "./db.js";
import { formatPrice, formatTinyPrice } from "../../utils/getTokenDetails.js";
import { buildWalletMap, normalizeWallets } from "../../utils/formaterLine.js"
import { formatWalletBalanceRow } from "../../utils/formatWalletBalanceRow.js";

export function buildLimitOrderKeyboard(selectedWallets, allWallets, mode = "buy", value, showAll = false) {
    const selectedKeys = new Set(selectedWallets);

    // Deduplicate wallets by address
    const seenAddresses = new Set();
    const dedupedWallets = allWallets.filter((w) => {
        const addr = w.address?.toLowerCase();
        if (addr && !seenAddresses.has(addr)) {
            seenAddresses.add(addr);
            return true;
        }
        return false;
    });

    const normalizedWallets = normalizeWallets(dedupedWallets);
    const walletsToShow = showAll ? normalizedWallets : normalizedWallets.slice(0, 4);
    const rows = [];

    rows.push([{ text: "➕ Setup Limit Order ➕", callback_data: "noop" }]);

    if (normalizedWallets.length > 4) {
        rows.push([{
            text: showAll ? "🔼 Select Wallets 🔼" : "🔽 Select Wallets 🔽",
            callback_data: "toggle_all_wallets"
        }]);
    }

    for (let i = 0; i < walletsToShow.length; i += 2) {
        const row = [];
        for (let j = i; j < i + 2 && j < walletsToShow.length; j++) {
            const wallet = walletsToShow[j];
            const walletKey = `w${j}`;
            const isSelected = selectedKeys.has(walletKey);
            const displayName = wallet.name?.trim() || shortAddress(wallet.address);

            row.push({
                text: `${isSelected ? "🟢" : "🔘"} ${displayName}`,
                callback_data: `toggle_wallet:${walletKey}`
            });
        }
        rows.push(row);
    }

    rows.push([
        { text: mode === "buy" ? "✅ Buy / Sell" : "Buy / Sell ✅", callback_data: "toggle_mode" }
    ]);

    const formattedTrigger = typeof value === "number" ? `${formatPrice(value)}` : (value || "---");
    rows.push([
        { text: `MCap: ${formattedTrigger} ✏️`, callback_data: "enter_mcap" }
    ]);

    const actionButtons = {
        buy: [
            [{ text: "Buy 1 SUI", callback_data: "buy_1:limit" }, { text: "Buy 5 SUI", callback_data: "buy_5:limit" }],
            [{ text: "Buy Custom SUI", callback_data: "buy_x:limit" }]
        ],
        sell: [
            [{ text: "Sell 50%", callback_data: "sell_50:limit" }, { text: "Sell 100%", callback_data: "sell_100:limit" }],
            [{ text: "Sell X%", callback_data: "sell_x:limit" }]
        ]
    };

    rows.push(...(actionButtons[mode] || []));
    rows.push([{ text: "← Back", callback_data: "back" }]);

    return rows;
}


export function buildFullKeyboard(selectedWallets, allWallets, showAll = false, mode = "buy") {

    const selectedAddressesSet = new Set(
        selectedWallets
            .map(k => allWallets[parseInt(k.replace('w', ''))]?.address?.toLowerCase())
            .filter(Boolean)
    );

    const normalizedWallets = normalizeWallets(allWallets);
    const walletsToShow = showAll ? normalizedWallets : normalizedWallets.slice(0, 4);

    const rows = [];
    rows.push([
        { text: "➕ Limit Order", callback_data: "limit_order" },
        { text: "➕ DCA Order", callback_data: "dca_order" }
    ]);
    rows.push([{ text: "⚙️ Manage Orders", callback_data: "manage_orders" }]);

    if (normalizedWallets.length > 1) {
        rows.push([
            {
                text: showAll ? "🔼 Select Wallets 🔼" : "🔽 Select Wallets 🔽",
                callback_data: "toggle_all_wallets"
            }
        ]);

        for (let i = 0; i < walletsToShow.length; i += 2) {
            const row = [];
            for (let j = i; j < i + 2 && j < walletsToShow.length; j++) {
                const wallet = walletsToShow[j];
                const walletKey = `w${j}`;
                const isSelected = selectedAddressesSet.has(wallet.address.toLowerCase());
                const displayName = wallet.name?.trim() || shortAddress(wallet.address);
                row.push({
                    text: `${isSelected ? "🟢" : "🔘"} ${displayName}`,
                    callback_data: `toggle_wallet:${walletKey}`,
                });
            }
            rows.push(row);
        }
    }

    rows.push([{ text: "Buy ↔ Sell", callback_data: "toggle_mode" }]);

    const actionRows = {
        buy: [
            [{ text: "Buy 1 SUI", callback_data: "buy_1:market" }, { text: "Buy 5 SUI", callback_data: "buy_5:market" }],
            [{ text: "Buy Custom SUI", callback_data: "buy_x:market" }]
        ],
        sell: [
            [{ text: "Sell 50%", callback_data: "sell_50:market" }, { text: "Sell 100%", callback_data: "sell_100:market" }],
            [{ text: "Sell X%", callback_data: "sell_x:market" }]
        ]
    };

    rows.push(...(actionRows[mode] || []));
    rows.push([
        { text: "❌ Cancel", callback_data: "cancel_to_main" },
        { text: "🔄 Refresh", callback_data: "refresh_info" }
    ]);

    return rows;
}


export async function renderMainMessage(ctx, userId) {
    let step = await fetchUserStep(userId);
    if (!step) return

    step.selectedWallets = (step.selectedWallets || []).filter(k => typeof k === 'string' && k.startsWith('w'));

    let { selectedWallets = [], wallets = [], tokenInfo } = step;
    if (!tokenInfo) return

    const normalizedWallets = normalizeWallets(wallets);
    const walletMap = buildWalletMap(normalizedWallets);


    const balances = await Promise.all(
        selectedWallets.map(async (key) => {
            const address = walletMap?.[key]?.address;
            if (!address) return null;

            try {
                const [tokenBalance, suiBalance] = await Promise.all([
                    withTimeout(getCoinBalance(address, tokenInfo.address), 5000),
                    withTimeout(getBalance(address), 5000),
                ]);
                return { wallet: address, suiBalance, tokenBalance };
            } catch (err) {
                return {
                    wallet: address,
                    suiBalance: { sui: 0, usd: 0 },
                    tokenBalance: { balance: 0, balanceUsd: 0 }
                };
            }
        })
    ).then(results => results.filter(Boolean));

    const explorerLink = `https://suiscan.xyz/mainnet/coin/${tokenInfo.address}/txs`;
    const chartLink = `https://dexscreener.com/sui/${tokenInfo.address}`;

    let formattedMessage = `<b>${tokenInfo.symbol}</b> | <b>${tokenInfo.name}</b>\n\n`;
    formattedMessage += `<a href="${explorerLink}">Explorer</a> | <a href="${chartLink}">Chart</a>\n\n`;
    formattedMessage += `CA: <code>${tokenInfo.address}</code>\n\n`;
    formattedMessage += `Price: <b>${formatTinyPrice(tokenInfo.price || 0)}</b>\n`;
    formattedMessage += `Market Cap: <b>${formatBigNumber(Number(tokenInfo.marketCap))}</b>\n\n`;
    // formattedMessage += `Liquidity: <b>${formatBigNumber(Number(tokenInfo.date))}</b>\n\n`;
    formattedMessage += `<b>Selected Wallets:</b>\n`;
    for (const { wallet, suiBalance, tokenBalance } of balances) {
        const fullWallet = normalizedWallets.find(w => w.address?.toLowerCase() === wallet.toLowerCase());
        formattedMessage += formatWalletBalanceRow(fullWallet, suiBalance, tokenBalance, tokenInfo);
    }

    const keyboard = {
        inline_keyboard: buildFullKeyboard(
            selectedWallets,
            normalizedWallets,
            step.showAllWallets ?? false,
            step.mode
        )
    };

    step.wallets = normalizedWallets;
    step.walletMap = walletMap;
    step.balances = balances;

    try {
        if (step.mainMessageId) {
            try {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    step.mainMessageId,
                    undefined,
                    formattedMessage,
                    {
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                        reply_markup: keyboard
                    }
                );
            } catch (err) {
                const sent = await ctx.reply(formattedMessage, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    reply_markup: keyboard
                });
                step.mainMessageId = sent.message_id;
            }
        } else {
            const sent = await ctx.reply(formattedMessage, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup: keyboard,
            });
            step.mainMessageId = sent.message_id;
        }
    } catch (err) {
        const sent = await ctx.reply(formattedMessage, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: keyboard,
        });
        step.mainMessageId = sent.message_id;
    }
    await saveUserStep(userId, step);
}


export function buildDcaKeyboard(
    selectedWallets,
    allWallets,
    showAll = false,
    mode = "buy",
    opts = {}
) {
    const { duration, interval } = opts;

    const selectedKeys = new Set(selectedWallets);
    const normalizedWallets = normalizeWallets(allWallets);
    const walletsToShow = showAll ? normalizedWallets : normalizedWallets.slice(0, 4);

    const rows = [];

    rows.push([{ text: "➕ Setup DCA Order ➕", callback_data: "noop" }]);

    if (normalizedWallets.length > 4) {
        rows.push([{
            text: showAll ? "🔼 Select Wallets 🔼" : "🔽 Select Wallets 🔽",
            callback_data: "toggle_all_wallets"
        }]);
    }

    for (let i = 0; i < walletsToShow.length; i += 2) {
        const row = [];
        for (let j = i; j < i + 2 && j < walletsToShow.length; j++) {
            const wallet = walletsToShow[j];
            const walletKey = `w${j}`;
            const isSelected = selectedKeys.has(walletKey);
            const displayName = wallet.name?.trim() || shortAddress(wallet.address);
            row.push({
                text: `${isSelected ? "🟢" : "🔘"} ${displayName}`,
                callback_data: `toggle_wallet:${walletKey}`
            });
        }
        rows.push(row);
    }

    rows.push([
        { text: mode === "buy" ? "✅ Buy / Sell" : "Buy / Sell ✅", callback_data: "toggle_mode" }
    ]);

    rows.push([
        {
            text: `Duration: ${duration ? `${duration}m` : '--'}`,
            callback_data: "dca_set_duration"
        },
        {
            text: `Interval: ${interval ? `${interval}m` : '--'}`,
            callback_data: "dca_set_interval"
        }
    ]);

    const actionButtons = {
        buy: [
            [{ text: "Buy 1 SUI", callback_data: "buy_1:dca" }, { text: "Buy 5 SUI", callback_data: "buy_5:dca" }],
            [{ text: "Buy X SUI", callback_data: "buy_x:dca" }]
        ],
        sell: [
            [{ text: "Sell 25%", callback_data: "sell_25:dca" }, { text: "Sell 50%", callback_data: "sell_50:dca" }],
            [{ text: "Sell X%", callback_data: "sell_x:dca" }]
        ]
    };

    rows.push(...(actionButtons[mode] || []));
    rows.push([{ text: "← Back", callback_data: "back" }]);

    return rows;
}