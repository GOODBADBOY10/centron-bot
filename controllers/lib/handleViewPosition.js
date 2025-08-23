import { getSuiUsdPrice } from "../../utils/getTokenDetails.js";
import { buildActionRows, buildTokenInlineRows } from "../../utils/keyboard/keyboardBuilder.js";
import { formatPositionSummary, } from "../../utils/positions.js";
import { saveUserStep, fetchUser } from "./db.js";
import { getBalance } from "./getBalance.js";
import { getTokenPositions } from "./showWalletsForPositions.js";

export const handleViewPosition = async (ctx, action) => {
    const userId = ctx.from.id.toString();
    const index = action.replace("view_pos_idx_", "");
    const walletKey = `wallet_${index}`;

    try {
        const user = await fetchUser(userId);
        const walletMap = user?.step?.walletMap || {};
        const walletAddress = walletMap[walletKey];

        if (!walletAddress) {
            return ctx.reply("⚠️ Wallet address not found. Please retry /positions.");
        }

        const walletObj = user.wallets?.find(
            (w) => (w.walletAddress || w.address) === walletAddress
        );

        const [suiUsdPriceRaw, suiBalanceResult] = await Promise.all([
            getSuiUsdPrice(walletAddress),
            getBalance(walletAddress)
        ]);

        const suiUsdPrice = suiUsdPriceRaw || 0;
        const suiBalance = suiBalanceResult?.sui || 0;
        const suiBalanceUssd = suiBalanceResult?.usd || 0;

        // const suiUsdPrice = await getSuiUsdPrice(walletAddress).then(p => p || 0);
        const tokenPositions = await getTokenPositions(userId, walletAddress, suiUsdPrice);

        if (!Array.isArray(tokenPositions)) {
            return ctx.reply("⚠️ Failed to load token positions.");
        }

        // const suiBalanceResult = await getBalance(walletAddress);
        // const suiBalance = suiBalanceResult.sui;
        // const suiBalanceUsd = suiBalance * suiUsdPrice;

        let message = `💳 Wallet balance: <b>${suiBalance.toFixed(3)} SUI ($${suiBalanceUssd.toFixed(3)})</b>\n\n`;

        const positions = tokenPositions.filter(t => t.symbol !== "SUI");

        if (!positions.length) {
            const displayAddress = walletAddress.slice(0, 6) + "..." + walletAddress.slice(-4);
            const label = walletObj?.name || displayAddress;
            const explorerUrl = `https://suivision.xyz/account/${walletAddress}`;
            const labelLink = `<a href="${explorerUrl}">${label}</a>`;

            return ctx.editMessageText(`${labelLink} You do not have any token positions.`, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "← Choose another wallet", callback_data: "back_to_positions_wallets" }]
                    ]
                }
            });
        }

        const orderedTokenAddrs = positions.map(p => p.tokenAddress || p.coinType);

        let selectedTokenAddress = user.step?.[`selectedToken_${index}`];
        const isSelectedValid = positions.find(p => (p.tokenAddress || p.coinType) === selectedTokenAddress);
        if (!selectedTokenAddress || !isSelectedValid) {
            selectedTokenAddress = orderedTokenAddrs[0];
        }

        const shortTokenMap = {};
        for (const [i, pos] of positions.entries()) {
            shortTokenMap[`token_${i}`] = pos.tokenAddress || pos.coinType;
            const summary = formatPositionSummary(pos, pos.tokenInfo, pos.readableBalance, suiUsdPrice);
            message += summary;
        }

        const totalPositionValueSUI = positions.reduce((sum, p) => sum + (p.valueSUI || 0), 0);
        const totalPositionValueUSD = positions.reduce((sum, p) => sum + (p.valueUSD || 0), 0);
        message = `📈 Positions: <b>${totalPositionValueSUI.toFixed(2)} SUI ($${totalPositionValueUSD.toFixed(2)})</b>\n\n` + message;

        // Save full step with cached positions
        const updatedStep = {
            ...user.step,
            walletMap,
            [`tokenMap_${index}`]: shortTokenMap,
            [`selectedToken_${index}`]: selectedTokenAddress,
            [`orderedTokens_${index}`]: orderedTokenAddrs,
            [`cachedPositions_${index}`]: positions, // Cached tokens
        };
        await saveUserStep(userId, updatedStep);

        const currentMode = user.step?.[`tradeMode_${index}`] || "buy";
        const tokenRows = buildTokenInlineRows(positions, selectedTokenAddress, index);
        const actionButtons = buildActionRows(currentMode, index);

        // Add refresh + back footer
        const footer = [
            [
                { text: "← Back", callback_data: "back_to_positions_wallets" },
                { text: "🔄 Refresh", callback_data: `refresh_position_idx_${index}` },
            ]
        ];

        const inline_keyboard = [...tokenRows, ...actionButtons, ...footer];

        return await ctx.editMessageText(message, {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard }
        });

    } catch (error) {
        return ctx.reply("⚠️ Failed to load wallet positions. Please try again.");
    }
};