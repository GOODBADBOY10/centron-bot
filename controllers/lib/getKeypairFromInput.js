import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as bip39 from 'bip39';
import { importWalletFromInput } from './importWallet.js';

export const getKeypairFromInput = async (input) => {
    let privateKey = input;
    let keypair;

    if (typeof privateKey === 'object') {
        if (Buffer.isBuffer(privateKey)) {
            privateKey = privateKey.toString('hex');
        } else if (privateKey?.type === 'Buffer' && Array.isArray(privateKey?.data)) {
            privateKey = Buffer.from(privateKey.data).toString('hex');
        } else if (typeof privateKey.seedPhrase === 'string') {
            privateKey = privateKey.seedPhrase;
        } else {
            throw new Error("🔐 Unable to extract private key. Please check your input format.");
        }
    } else if (typeof privateKey !== 'string') {
        throw new Error(`🧾 Private key must be a string or buffer. Got: ${typeof privateKey}`);
    }

    try {
        if (bip39.validateMnemonic(privateKey)) {
            keypair = Ed25519Keypair.deriveKeypair(privateKey, "m/44'/784'/0'/0'/0'");
        } else if (privateKey.startsWith('suiprivkey1')) {
            const decoded = decodeSuiPrivateKeyLocal(privateKey);
            keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
        } else if (privateKey.length === 64 || privateKey.length === 66) {
            let hexKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
            const keyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
            keypair = Ed25519Keypair.fromSecretKey(keyBytes);
        } else {
            const walletData = await importWalletFromInput(privateKey);
            if (walletData.type === "Mnemonic") {
                keypair = Ed25519Keypair.deriveKeypair(walletData.phrase, "m/44'/784'/0'/0'/0'");
            } else {
                let key = walletData.privateKey;
                if (key.startsWith('suiprivkey1')) {
                    const decoded = decodeSuiPrivateKeyLocal(key);
                    keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
                } else {
                    if (key.startsWith('0x')) key = key.slice(2);
                    const keyBytes = new Uint8Array(Buffer.from(key, 'hex'));
                    keypair = Ed25519Keypair.fromSecretKey(keyBytes);
                }
            }
        }
        if (!keypair) throw new Error("🔑 Failed to create keypair.");
        return keypair;
    } catch (e) {
        throw new Error(`🔑 Keypair creation failed: ${e.message}`);
    }
};

export function decodeSuiPrivateKeyLocal(privateKey) {
    if (!privateKey.startsWith('suiprivkey1')) {
        throw new Error('Invalid Sui private key format');
    }

    try {
        // Use the imported decodeSuiPrivateKey from the SDK
        return decodeSuiPrivateKey(privateKey);
    } catch (error) {
        throw new Error(`Failed to decode Sui private key: ${error.message}`);
    }
}