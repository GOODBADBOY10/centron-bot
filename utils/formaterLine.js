import { shortAddress } from "../controllers/lib/shortAddress.js";
import { abbreviateNumber, formatPriceAbbreviated, formatPricePrecise } from "./getTokenDetails.js";

export function formatWalletBalanceLine(wallet, tokenBalance, suiBalance, tokenInfo, displayName = null) {
    const walletDisplay = displayName || shortAddress(wallet);
    const formattedToken = abbreviateNumber(tokenBalance.balance);
    const formattedSui = formatPricePrecise(suiBalance);
    const formattedUsd = formatPriceAbbreviated(tokenBalance.balanceUsd);

    return ` 💳 ${walletDisplay} | ${formattedToken} ${tokenInfo.symbol} (worth ${formattedSui} SUI / ${formattedUsd})`;
}

export function normalizeWallets(wallets = []) {
    return wallets
        .filter(w => typeof w === 'object' && (w.address || w.walletAddress))
        .map(w => {
            const address = w.address || w.walletAddress;
            return {
                ...w,
                address,
                name: w.name || shortAddress(address),
                buySlippage: w.buySlippage ?? 0.01,
                sellSlippage: w.sellSlippage ?? 0.01,
            };
        });
}


export function toAddressList(wallets) {
    return wallets
        .map(w => typeof w === 'string' ? w : (w?.address || w?.walletAddress))
        .filter(Boolean)
        .map(a => a.toLowerCase());
}

export function buildWalletMap(wallets = []) {
    return normalizeWallets(wallets).reduce((map, w, i) => {
        map[`w${i}`] = w;
        return map;
    }, {});
}