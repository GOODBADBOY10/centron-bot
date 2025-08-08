import { getUserPositions } from "../controllers/lib/db.js";
import { formatMarketCap, formatTokenBalance, getFallbackTokenDetails } from "./getTokenDetails.js";

export async function getValidPositions(userId, walletAddress) {
    const positions = await getUserPositions(userId, walletAddress);
    const tokenCache = {};
    const validPositions = [];
    for (const pos of positions) {
        if (!tokenCache[pos.tokenAddress]) {
            tokenCache[pos.tokenAddress] = await getFallbackTokenDetails(pos.tokenAddress, walletAddress);
        }
        const tokenInfo = tokenCache[pos.tokenAddress]?.tokenInfo;
        if (tokenInfo?.price && pos.symbol) {
            validPositions.push({
                ...pos,
                tokenInfo,
                tokenAmount: pos.totalAmount / 10 ** tokenInfo.decimals,
            });
        }
    }

    return { validPositions, tokenCache };
}

export function formatPositionSummary(pos, tokenInfo, tokenAmount, suiUsdPrice) {
    const currentPrice = parseFloat(tokenInfo.price);
    const marketCap = parseFloat(tokenInfo.marketCap || 0);
    const currentValue = tokenAmount * currentPrice;
    const currentValueSui = suiUsdPrice > 0 ? currentValue / suiUsdPrice : 0;
    const pnlValue = currentValue - (pos.totalCostSUI || 0);

    let rawPnlPercent = 0;
    if (pos.avgPriceSUI > 0) {
        rawPnlPercent = ((tokenInfo.priceInSui - pos.avgPriceSUI) / pos.avgPriceSUI) * 100;
    }

    const cappedPnlPercent = Math.min(rawPnlPercent, 9999);
    const pnlEmoji = rawPnlPercent >= 0 ? "🟩" : "🟥";
    const tokenAddress = pos.tokenAddress || pos.coinType || "";
    const tokenLine = `$${pos.symbol} - ${currentValueSui.toFixed(2)} SUI ($${currentValue.toFixed(2)})`;
    let msg = `${tokenLine}\n`;
    msg += `<code>${tokenInfo.address}</code>\n`;

    msg += `• Price & MC: <b>${formatTinyPrice(currentPrice)} — ${formatMarketCap(marketCap)}</b>\n`;

    if (pos.avgPriceSUI > 0) {
        const avgTotalUsd = (pos.avgPriceSUI * tokenAmount) * suiUsdPrice;
        msg += `• Avg Entry: <b>${formatTinyPrice(pos.avgPriceSUI)} — ${formatMarketCap(avgTotalUsd)}</b>\n`;
    }

    msg += `• Balance: <b>${formatTokenBalance(tokenAmount)} $${pos.symbol}</b>\n\n`;

    if (pos.avgPriceSUI > 0) {
        msg += `• PnL: <b>${cappedPnlPercent.toFixed(2)}% (${pnlValue >= 0 ? '+' : ''}$${pnlValue.toFixed(2)}) ${pnlEmoji}</b>\n\n`;
    }

    return msg;
}

function formatTinyPrice(value) {
    if (!value || isNaN(value)) return "$0.00";
    if (value >= 1) return `$${value.toFixed(2)}`;
    if (value >= 0.01) return `$${value.toFixed(4)}`;
    if (value >= 0.0001) return `$${value.toFixed(6)}`;
    const exponent = Math.floor(Math.log10(value));
    const subscriptDigits = Math.abs(exponent) - 1; // e.g. 1e-6 → subscript 5
    const base = Math.round(value * Math.pow(10, subscriptDigits + 1)); // significant digits

    const subscript = subscriptDigits
        .toString()
        .split("")
        .map(d => "₀₁₂₃₄₅₆₇₈₉"[d])
        .join("");
    return `$0.0${subscript}${base}`;
}