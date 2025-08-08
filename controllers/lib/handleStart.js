import { saveUserStep, getUser, saveUser, addWalletToUser, incrementReferrer } from "./db.js";
import { encryptWallet, generateWallet } from "./generateWallet.js";
import { getBalance } from "./getBalance.js";
import { mainMenu } from "./mainMenu.js";

export async function handleStart(ctx) {
    try {
        const userId = ctx.from.id.toString();
        const payload = ctx.startPayload;
        const user = await getUser(userId, payload);

        if (payload?.startsWith("ref_")) {
            const referrerId = payload.replace("ref_", "");
            await incrementReferrer(referrerId);
        }

        const referralLink = `https://t.me/${ctx.me}?start=ref_${userId}`;

        if (!user || !user.wallets || user.wallets.length === 0) {
            const wallet = await generateWallet();
            const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET
            const encryptedPrivateKey = encryptWallet(wallet.privateKey, ENCRYPTION_SECRET);
            const encryptedSeedPhrase = encryptWallet(wallet.seedPhrase, ENCRYPTION_SECRET);

            await addWalletToUser(userId, {
                ...wallet,
                privateKey: encryptedPrivateKey,
                seedPhrase: encryptedSeedPhrase,
            });

            await saveUser(userId, {
                walletAddress: wallet.walletAddress,
                privateKey: encryptedPrivateKey,
                seedPhrase: encryptedSeedPhrase,
                createdAt: new Date().toISOString(),
            });

            await saveUserStep(userId, {
                state: "confirming_seed_phrase",
                expectedPrivateKey: encryptedPrivateKey,
                expectedSeed: encryptedSeedPhrase,
            });
            const decryptedKey = wallet.privateKey;
            const decryptedSeed = wallet.seedPhrase;

            let message = "";
            message += "✅ Generated new wallet\n\n";
            message += "Address:\n";
            message += `<code>${wallet.walletAddress}</code> (tap to copy)\n\n`;
            message += "Private key:\n";
            message += `<code>${decryptedKey}</code> (tap to copy)\n\n`;
            message += "Seed phrase:\n";
            message += `<code>${decryptedSeed}</code> (tap to copy)\n\n`;
            message +=
                "⚠️ Save your seed phrase on paper only. Avoid storing it digitally. After you finish saving/importing the wallet credentials, delete this message. <b>The bot will not display this information again.</b>\n";

            await ctx.replyWithHTML(message);
            await ctx.reply("What is the mnemonic phrase or private key for this wallet?");
        } else {
            const wallets = user?.wallets || [];

            if (!user) {
                await ctx.reply("❌ Wallet not found. Use /start to generate one.");
                return;
            }

            const balances = await Promise.all(
                wallets.map(wallet =>
                    wallet.walletAddress
                        ? getBalance(wallet.walletAddress).then(balance => ({
                            wallet,
                            balance: balance || { sui: "0", usd: "0" },
                        }))
                        : null
                )
            );

            let message = "";
            message += "Welcome to *Centron Bot* 👋\n\n";
            message += "Trade seamlessly on Sui with low fees + high speeds. We support all DEXes, including memecoin launchpads.\n\n";
            // message += "Sui Wallet Address:\n";

            balances.forEach((entry, i) => {
                if (!entry) return;
                const { wallet, balance } = entry;
                const address = wallet.walletAddress;
                const name = wallet.name?.trim();
                const label = `${name || `Sui Wallet ${i + 1}`}`;
                message += `${label}: ${balance.sui} SUI ($${balance.usd})\n`;
                message += `\`${address}\` (tap to copy)\n\n`;
            });

            message += 'To start trading, tap "Buy a Token" and paste the token address.';

            await ctx.reply(message, {
                parse_mode: "MarkdownV2",
                ...mainMenu,
            });
        }
    } catch (err) {
        console.error("handleStart error:", err);
    }
}