import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { fromHex, fromBase64 } from '@mysten/bcs';
import * as bip39 from 'bip39';
import { bech32 } from 'bech32';

export async function importWalletFromInput(input) {
  if (!input || typeof input !== "string") {
    throw new Error("Input must be a non-empty string");
  }
  input = input.trim();

  // Try mnemonic (12 or 24 space-separated words)
  if (bip39.validateMnemonic(input)) {
    const keypair = Ed25519Keypair.deriveKeypair(input, "m/44'/784'/0'/0'/0'");
    return {
      address: keypair.getPublicKey().toSuiAddress(),
      privateKey: keypair.getSecretKey(), // Returns Bech32 format
      phrase: input,
      type: "Mnemonic"
    };
  }

  // Try Sui Bech32 private key (suiprivkey1...)
  if (input.startsWith('suiprivkey1')) {
    try {
      // Method 1: Try using Ed25519Keypair.fromBech32 (if available)
      if (typeof Ed25519Keypair.fromBech32 === 'function') {
        try {
          const keypair = Ed25519Keypair.fromBech32(input);
          return {
            address: keypair.getPublicKey().toSuiAddress(),
            privateKey: input,
            type: "Bech32PrivateKey"
          };
        } catch (bech32Err) {
          // Fall through to manual decoding
        }
      }

      // Method 2: Manual Bech32 decoding
      const decoded = bech32.decode(input);
      const bytes = bech32.fromWords(decoded.words);
      const privateKeyBytes = new Uint8Array(bytes.slice(1, 33)); // Skip scheme byte, take 32 bytes

      const keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
      return {
        address: keypair.getPublicKey().toSuiAddress(),
        privateKey: input,
        type: "Bech32PrivateKey"
      };

    } catch (err) {
      throw new Error(`Invalid Bech32 private key format: ${err.message}`);
    }
  }

  // Try base64-encoded Bech32 private key
  if (/^[A-Za-z0-9+/]+=*$/.test(input)) {
    try {
      const decoded = atob(input);
      if (decoded.startsWith('suiprivkey1')) {
        // This is a base64-encoded Bech32 key, recursively call with decoded value
        return await importWalletFromInput(decoded);
      }
    } catch (err) {
      // Not valid base64, continue to next check
    }
  }

  // Try private key: hex (64 chars for 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(input)) {
    try {
      const privateKeyBytes = fromHex(input);
      if (privateKeyBytes.length !== 32) {
        throw new Error(`Private key must be exactly 32 bytes, got ${privateKeyBytes.length}`);
      }

      const keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
      return {
        address: keypair.getPublicKey().toSuiAddress(),
        privateKey: keypair.getSecretKey(),
        type: "HexPrivateKey"
      };
    } catch (err) {
      throw new Error(`Invalid hex private key: ${err.message}`);
    }
  }

  // Try private key: base64 (44 chars for 32 bytes)
  if (/^[A-Za-z0-9+/]{43}=$/.test(input)) {
    try {
      const privateKeyBytes = fromBase64(input);
      if (privateKeyBytes.length !== 32) {
        throw new Error(`Private key must be exactly 32 bytes, got ${privateKeyBytes.length}`);
      }

      const keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
      return {
        address: keypair.getPublicKey().toSuiAddress(),
        privateKey: keypair.getSecretKey(), // Return in Bech32 format for consistency
        type: "Base64PrivateKey"
      };
    } catch (err) {
      throw new Error(`Invalid base64 private key: ${err.message}`);
    }
  }

  throw new Error(`Invalid format. Input length: ${input.length}. Supported formats: mnemonic phrase, Bech32 private key (suiprivkey1...), base64-encoded Bech32, 64-char hex, or 44-char base64.`);
}