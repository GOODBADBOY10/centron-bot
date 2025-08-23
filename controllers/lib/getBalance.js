import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
const SUI_RPC_URL = "https://fullnode.mainnet.sui.io:443";

let cachedSuiPrice = null;
let lastPriceFetchTime = 0;

const blockberry = process.env.BLOCKBERRYAPIKEY;

export async function getBalance(address) {
    if (!address) throw new Error("No address provided to getBalance");

    try {
        const res = await fetch(
            `https://api.blockberry.one/sui/v1/accounts/${address}/balance`,
            {
                headers: {
                    accept: "*/*",
                    "x-api-key": blockberry,
                },
            }
        );

        if (!res.ok) {
            throw new Error(`Blockberry API error: ${res.status} ${res.statusText}`);
        }

        const balances = await res.json();

        // Find the SUI entry (coinType = 0x2::sui::SUI)
        const suiData = balances.find(
            (item) => item.coinType === "0x2::sui::SUI"
        );

        if (!suiData) {
            return { sui: 0, usd: 0 };
        }

        return {
            sui: Number(suiData.balance.toFixed(3)),
            usd: Number(suiData.balanceUsd.toFixed(2)),
        };
    } catch (error) {
        console.error("Error fetching balance from Blockberry:", error);
        return null;
    }
}

// export async function getBalance(address) {
//     if (!address) throw new Error("No address provided to getBalance");
//     try {
//         const balanceResult = await suiClient.getBalance({ owner: address });
//         const mistBalance = BigInt(balanceResult.totalBalance);
//         const suiBalance = Number(mistBalance) / 1e9;
//         const res = await fetch("https://public-api.birdeye.so/defi/price?address=0x2::sui::SUI", {
//             headers: {
//                 accept: 'application/json',
//                 'x-chain': 'sui',
//                 'X-API-KEY': process.env.BIRD_EYE_API_KEY
//             }
//         });

//         const json = await res.json();

//         const suiPrice = json?.data?.value || 0;

//         // Compute balance in USD
//         const usdValue = suiBalance * suiPrice;

//         return {
//             sui: Number(suiBalance.toFixed(3)),
//             usd: Number(usdValue.toFixed(2)),
//         };
//     } catch (error) {
//         return null;
//     }
// }


export async function getBatchBalances(addresses) {
    if (!addresses || addresses.length === 0) return [];

    try {
        // 1. Fetch SUI price once for all addresses
        const now = Date.now();
        if (!cachedSuiPrice || now - lastPriceFetchTime > 300000) {
            const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd");
            if (res.ok) {
                const json = await res.json();
                cachedSuiPrice = json?.sui?.usd || 0;
                lastPriceFetchTime = now;
            }
        }

        // 2. Fetch all balances in parallel
        const balancePromises = addresses.map(async (address) => {
            try {
                const balanceResult = await suiClient.getBalance({ owner: address });
                const mistBalance = BigInt(balanceResult.totalBalance);
                const suiBalance = Number(mistBalance) / 1e9;
                const usdValue = suiBalance * cachedSuiPrice;

                return {
                    address,
                    sui: Number(suiBalance.toFixed(3)),
                    usd: Number(usdValue.toFixed(2)),
                };
            } catch (error) {
                return {
                    address,
                    sui: 0,
                    usd: 0
                };
            }
        });

        // 3. Wait for all balances
        const results = await Promise.allSettled(balancePromises);
        return results
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value);

    } catch (error) {
        return [];
    }
}