import * as dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

const blockberryApiKey = process.env.BLOCKBERRYAPIKEY;

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