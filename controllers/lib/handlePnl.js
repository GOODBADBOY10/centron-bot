import { fetchUser } from "./db.js";
import { getSuiUsdPrice } from "../../utils/getTokenDetails.js";

export const handleViewPnL = async (ctx, index) => {
    const userId = ctx.from.id.toString();
    const user = await fetchUser(userId);

    const step = user?.step || {};
    const walletKey = `wallet_${index}`;
    const walletAddress = step.walletMap?.[walletKey];

    if (!walletAddress) {
        return ctx.reply("⚠ Wallet not found.");
    }

    const cached = step[`cachedPositions_${index}`];
    if (!Array.isArray(cached) || cached.length === 0) {
        return ctx.reply("⚠ No cached token data. Please /positions first.");
    }

    const suiUsdPrice = await getSuiUsdPrice(walletAddress).then(p => p || 0);

    let totalPnlUsd = 0;
    let pnlMessage = `📊 <b>PnL Summary</b>\n\n`;

    for (const pos of cached) {
        const { tokenInfo, readableBalance, valueUSD = 0, avgEntryUsd } = pos;
        if (!avgEntryUsd || !tokenInfo || !readableBalance) continue;
        const currentValue = Number(valueUSD);
        const entryValue = Number(avgEntryUsd) * Number(readableBalance);
        const pnl = currentValue - entryValue;
        const pnlPercent = entryValue > 0 ? (pnl / entryValue) * 100 : 0;
        totalPnlUsd += pnl;
        pnlMessage += `• <b>${tokenInfo.symbol}</b>: ${pnl >= 0 ? "🟩" : "🟥"} $${pnl.toFixed(Math.abs(pnl) < 0.01 ? 6 : 3)} (${pnlPercent.toFixed(2)}%)\n`;
    }

    pnlMessage += `\n<b>Total PnL:</b> ${totalPnlUsd >= 0 ? "🟩" : "🟥"} $${totalPnlUsd.toFixed(3)}`;

    return ctx.editMessageText(pnlMessage, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [{ text: "← Back to positions", callback_data: `view_pos_idx_${index}` }]
            ]
        }
    });
};