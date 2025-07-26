import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import * as crypto from 'crypto';
import * as bip39 from 'bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

const ENCRYPTION_ALGORITHM = process.env.ENCRYPTION_ALGORITHM;
const IV_LENGTH = process.env.IV_LENGTH;

export async function generate12WordMnemonic() {
  // 128 bits entropy for 12-word mnemonic
  const entropy = crypto.randomBytes(16); // 16 bytes = 128 bits
  const mnemonic = bip39.entropyToMnemonic(entropy.toString('hex'), wordlist);
  return mnemonic
}

export async function generateWallet() {
  const mnemonic = await generate12WordMnemonic();
  const keypair = Ed25519Keypair.deriveKeypair(mnemonic);
  const publicKey = keypair.getPublicKey().toSuiAddress();
  const suiPrivateKey = keypair.getSecretKey();
  return {
    seedPhrase: mnemonic,
    walletAddress: publicKey,
    privateKey: suiPrivateKey,
  }
}

export function encryptWallet(wallet, password) {
  const json = JSON.stringify(wallet);
  const key = crypto.createHash("sha256").update(password).digest();
  const iv = crypto.randomBytes(process.env.IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}


// Decrypt wallet JSON string back to object
export function decryptWallet(encrypted, password) {
  const [ivHex, encryptedHex] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encryptedData = Buffer.from(encryptedHex, "hex");
  const key = crypto.createHash("sha256").update(password).digest();

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}