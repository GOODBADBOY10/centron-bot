import { shortAddress } from "./shortAddress.js";

export function getWalletDisplayName(wallet) {
    if (!wallet) return 'Unnamed Wallet';

    const address = wallet.address || wallet.walletAddress || '';
    const name = (wallet.name || '').trim();

    if (name) {
        return name;
    }

    return address ? shortAddress(address) : 'Unnamed Wallet';
}