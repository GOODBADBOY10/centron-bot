import * as dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

const blockberryApiKey = process.env.BLOCKBERRYAPIKEY;

export const getUserTokenDetailsB = async (address, token = '0x2::sui::SUI') => {
    const options = {
        method: 'GET',
        url: `https://api.blockberry.one/sui/v1/accounts/${address}/balance`,
        headers: {
            accept: '*/*',
            'x-api-key': blockberryApiKey,
        },
    };

    try {
        const res = await axios.request(options);
        const balances = res.data;

        if (!Array.isArray(balances) || balances.length === 0) {
            return null;
        }

        const coin_details = balances.find(
            (coin) => coin.coinType?.trim().toLowerCase() === token.trim().toLowerCase()
        );

        return coin_details || null;
    } catch (error) {
        return null;
    }
};


export const getUserTokenDetails = async (address, token = '0x2::sui::SUI') => {
    const options = {
        method: 'GET',
        url: `https://api.blockberry.one/sui/v1/accounts/${address}/balance`,
        headers: {
            accept: '*/*',
            'x-api-key': blockberryApiKey,
        },
    };

    try {
        const res = await axios.request(options);
        const balances = res.data;

        if (!Array.isArray(balances) || balances.length === 0) {
            console.warn("❌ No token balances found for this address");
            return null;
        }

        // Find the requested token
        const tokenDetails = balances.find(
            (coin) => coin.coinType?.trim().toLowerCase() === token.trim().toLowerCase()
        );

        if (!tokenDetails) {
            console.warn(`❌ Token ${token} not found in balances`);
            return null;
        }

        // Find SUI token for price conversion
        const suiDetails = balances.find(
            (coin) => coin.coinType?.trim().toLowerCase() === '0x2::sui::sui'
        );

        if (!suiDetails) {
            console.warn("❌ SUI token not found in balances - cannot calculate SUI price");
            return {
                ...tokenDetails,
                suiPrice: null,
                priceInSUI: null,
                error: 'SUI price unavailable'
            };
        }

        // Calculate token price in SUI terms
        const tokenUsdPrice = tokenDetails.coinPrice;
        const suiUsdPrice = suiDetails.coinPrice;
        const priceInSUI = tokenUsdPrice / suiUsdPrice;

        return {
            ...tokenDetails,
            suiPrice: suiUsdPrice,           // SUI price in USD
            priceInSUI: priceInSUI,         // Token price in SUI terms
            priceInUSD: tokenUsdPrice       // Token price in USD (same as coinPrice)
        };

    } catch (error) {
        console.error("❌ Error fetching balances:");
        return null;
    }
};


export async function fetchSuiPriceFallback(address) {
    const options = {
        method: 'GET',
        url: 'https://api.blockberry.one/sui/v1/accounts/' + address + '/balance',
        headers: {
            accept: '*/*',
            'x-api-key': blockberryApiKey
        }
    };

    try {
        const res = await axios.request(options);
        const data = res.data?.data;
        const suiInfo = data?.find(item => item.coinType === '0x2::sui::SUI');
        return suiInfo?.coinPrice || 0;
    } catch (err) {
        return 0;
    }
}