import { addWalletToUser } from "./db";
import { getBalance } from "./getBalance.js";


export async function fetchBalanceAndSave(userId, wallet) {
    const balance = await getBalance(wallet.address);

    if (balance === null) {
        console.error('Failed to fetch balance. Wallet not saved.');
        return;
    }

    wallet.balance = balance;
    await addWalletToUser(userId, wallet);
}

