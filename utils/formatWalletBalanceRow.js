import { getWalletDisplayName } from "../controllers/lib/getWalletName.js";
import { abbreviateNumber, formatPriceAbbreviated, formatPricePrecise } from "./getTokenDetails.js";

export function formatWalletBalanceRow(wallet, suiBalance, tokenBalance, tokenInfo) {
    const tokenAmount = Number(tokenBalance.balance);
    const tokenValueUSD = Number(tokenBalance.balanceUsd);
    const formattedSui = suiBalance?.sui != null ? formatPricePrecise(suiBalance.sui) : "0.000";
    const formattedToken = abbreviateNumber(tokenAmount);
    const formattedUsdValue = formatPriceAbbreviated(tokenValueUSD);
    const formattedSuiValue = tokenInfo.priceInSui
        ? formatPricePrecise(tokenAmount * tokenInfo.priceInSui)
        : "";

    const walletName = getWalletDisplayName(wallet);
    const explorerWalletLink = `https://suiexplorer.com/address/${wallet.address || wallet.walletAddress}?network=mainnet`;
    const boldWalletLink = `<a href="${explorerWalletLink}">${walletName}</a>`;

    return `${boldWalletLink} | ${formattedSui} SUI | ${formattedToken} $${tokenInfo.symbol}` +
        (formattedSuiValue
            ? ` (worth ${formattedSuiValue} SUI / ${formattedUsdValue})\n`
            : ` (worth ${formattedUsdValue})\n`);
}