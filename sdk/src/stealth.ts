import { ethers } from 'ethers';
import * as crypto from 'crypto';

/**
 * Stealth Address System for Anonymous Buying
 *
 * This module implements EIP-5564 style stealth addresses for anonymous token purchases.
 *
 * How it works:
 * 1. User generates a stealth meta-address (spending key + viewing key)
 * 2. When buying, a fresh stealth address is generated
 * 3. Anyone can fund the stealth address without knowing who controls it
 * 4. Only the recipient can derive the private key to spend from that address
 *
 * This breaks the link between:
 * - Source of ETH (public deposit)
 * - Destination of tokens (private commitment)
 *
 * Combined with the ZkAMM's commitment system, this enables:
 * - Anonymous entry into the privacy pool
 * - Untraceable token swaps
 * - Private exits to fresh addresses
 */

/**
 * Stealth meta-address: publish this to receive anonymous payments
 */
export interface StealthMetaAddress {
  /** Spending public key (compressed) */
  spendingPublicKey: string;
  /** Viewing public key (compressed) */
  viewingPublicKey: string;
}

/**
 * A generated stealth address and the data needed to spend from it
 */
export interface StealthAddress {
  /** The stealth address (Ethereum address) */
  address: string;
  /** Ephemeral public key (sender publishes this) */
  ephemeralPublicKey: string;
  /** View tag for efficient scanning (first byte of shared secret) */
  viewTag: number;
}

/**
 * Keys needed to spend from a stealth address
 */
export interface StealthSpendingKey {
  /** Private key to sign transactions */
  privateKey: string;
  /** The stealth address */
  address: string;
}

/**
 * Stealth wallet for generating and deriving stealth addresses
 */
export class StealthWallet {
  private spendingPrivateKey: string;
  private viewingPrivateKey: string;
  private spendingPublicKey: string;
  private viewingPublicKey: string;

  /**
   * Create a stealth wallet from a seed phrase
   * Derives separate keys for spending and viewing
   */
  constructor(seedPhrase: string) {
    // Derive spending key from seed
    const spendingHd = ethers.HDNodeWallet.fromPhrase(
      seedPhrase,
      undefined,
      "m/44'/60'/0'/0/0"
    );
    this.spendingPrivateKey = spendingHd.privateKey;
    this.spendingPublicKey = spendingHd.publicKey;

    // Derive viewing key from different path
    const viewingHd = ethers.HDNodeWallet.fromPhrase(
      seedPhrase,
      undefined,
      "m/44'/60'/0'/1/0"
    );
    this.viewingPrivateKey = viewingHd.privateKey;
    this.viewingPublicKey = viewingHd.publicKey;
  }

  /**
   * Get the stealth meta-address to publish for receiving
   */
  getMetaAddress(): StealthMetaAddress {
    return {
      spendingPublicKey: this.spendingPublicKey,
      viewingPublicKey: this.viewingPublicKey,
    };
  }

  /**
   * Generate a stealth address for a recipient
   * The sender calls this to create an address only the recipient can spend from
   *
   * @param recipientMetaAddress - Recipient's published stealth meta-address
   * @returns Stealth address data
   */
  static generateStealthAddress(
    recipientMetaAddress: StealthMetaAddress
  ): StealthAddress {
    // Generate ephemeral keypair
    const ephemeralWallet = ethers.Wallet.createRandom();
    const ephemeralPrivateKey = ephemeralWallet.privateKey;
    const ephemeralPublicKey = ephemeralWallet.signingKey.publicKey;

    // Compute shared secret: ECDH(ephemeralPrivate, viewingPublic)
    const sharedSecret = StealthWallet.computeSharedSecret(
      ephemeralPrivateKey,
      recipientMetaAddress.viewingPublicKey
    );

    // Compute stealth private key: spending_private + hash(shared_secret)
    // Since we don't have spending private, compute public key directly
    const stealthPublicKey = StealthWallet.deriveStealthPublicKey(
      recipientMetaAddress.spendingPublicKey,
      sharedSecret
    );

    // Convert public key to address
    const stealthAddress = ethers.computeAddress(stealthPublicKey);

    // View tag is first byte of shared secret hash (for efficient scanning)
    const viewTag = parseInt(sharedSecret.slice(2, 4), 16);

    return {
      address: stealthAddress,
      ephemeralPublicKey,
      viewTag,
    };
  }

  /**
   * Derive the spending key for a stealth address
   * Only the recipient with the viewing and spending keys can do this
   *
   * @param ephemeralPublicKey - The ephemeral public key from the stealth address announcement
   * @returns Private key to spend from the stealth address
   */
  deriveStealthSpendingKey(ephemeralPublicKey: string): StealthSpendingKey {
    // Compute shared secret: ECDH(viewingPrivate, ephemeralPublic)
    const sharedSecret = StealthWallet.computeSharedSecret(
      this.viewingPrivateKey,
      ephemeralPublicKey
    );

    // Compute stealth private key: spending_private + hash(shared_secret)
    const sharedSecretScalar = BigInt(sharedSecret);
    const spendingScalar = BigInt(this.spendingPrivateKey);

    // Field order for secp256k1
    const n = BigInt(
      '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
    );

    // Stealth private key = (spending_private + shared_secret) mod n
    const stealthPrivateScalar = (spendingScalar + sharedSecretScalar) % n;
    const stealthPrivateKey =
      '0x' + stealthPrivateScalar.toString(16).padStart(64, '0');

    // Derive address from private key
    const wallet = new ethers.Wallet(stealthPrivateKey);

    return {
      privateKey: stealthPrivateKey,
      address: wallet.address,
    };
  }

  /**
   * Check if a stealth address belongs to this wallet using the view tag
   * This is a quick check before the more expensive full derivation
   *
   * @param ephemeralPublicKey - The ephemeral public key from announcement
   * @param viewTag - The view tag from announcement
   * @returns True if this address might belong to us (requires full check to confirm)
   */
  checkViewTag(ephemeralPublicKey: string, viewTag: number): boolean {
    const sharedSecret = StealthWallet.computeSharedSecret(
      this.viewingPrivateKey,
      ephemeralPublicKey
    );
    const computedViewTag = parseInt(sharedSecret.slice(2, 4), 16);
    return computedViewTag === viewTag;
  }

  /**
   * Scan for stealth addresses belonging to this wallet
   *
   * @param announcements - List of stealth address announcements
   * @returns List of stealth addresses we can spend from
   */
  scanForOwnedAddresses(
    announcements: Array<{ ephemeralPublicKey: string; stealthAddress: string; viewTag: number }>
  ): StealthSpendingKey[] {
    const owned: StealthSpendingKey[] = [];

    for (const announcement of announcements) {
      // Quick check with view tag
      if (!this.checkViewTag(announcement.ephemeralPublicKey, announcement.viewTag)) {
        continue;
      }

      // Full derivation to confirm
      const derived = this.deriveStealthSpendingKey(announcement.ephemeralPublicKey);
      if (derived.address.toLowerCase() === announcement.stealthAddress.toLowerCase()) {
        owned.push(derived);
      }
    }

    return owned;
  }

  /**
   * Compute ECDH shared secret
   */
  private static computeSharedSecret(
    privateKey: string,
    publicKey: string
  ): string {
    // Use ethers SigningKey for ECDH
    const signingKey = new ethers.SigningKey(privateKey);
    const sharedPoint = signingKey.computeSharedSecret(publicKey);
    // Hash the shared point to get a scalar
    return ethers.keccak256(sharedPoint);
  }

  /**
   * Derive stealth public key from spending public key and shared secret
   */
  private static deriveStealthPublicKey(
    spendingPublicKey: string,
    sharedSecret: string
  ): string {
    // Get the generator point multiplied by shared secret
    const sharedSecretKey = new ethers.SigningKey(
      '0x' + BigInt(sharedSecret).toString(16).padStart(64, '0')
    );
    const sharedPublicKey = sharedSecretKey.publicKey;

    // Add spending public key + (G * shared_secret)
    // Using the property that public keys are elliptic curve points
    return addPublicKeys(spendingPublicKey, sharedPublicKey);
  }
}

/**
 * Add two secp256k1 public keys (point addition)
 * Returns the compressed public key of the sum
 */
function addPublicKeys(pubKey1: string, pubKey2: string): string {
  // Parse uncompressed public keys (remove 0x04 prefix)
  const p1 = parseUncompressedPublicKey(pubKey1);
  const p2 = parseUncompressedPublicKey(pubKey2);

  // secp256k1 curve parameters
  const p = BigInt(
    '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F'
  );

  // Point addition on secp256k1
  // If points are equal, use point doubling formula
  let x3: bigint, y3: bigint;

  if (p1.x === p2.x && p1.y === p2.y) {
    // Point doubling
    const lambda = (3n * p1.x * p1.x * modInverse(2n * p1.y, p)) % p;
    x3 = (lambda * lambda - 2n * p1.x) % p;
    y3 = (lambda * (p1.x - x3) - p1.y) % p;
  } else {
    // Point addition
    const lambda = ((p2.y - p1.y) * modInverse(p2.x - p1.x, p)) % p;
    x3 = (lambda * lambda - p1.x - p2.x) % p;
    y3 = (lambda * (p1.x - x3) - p1.y) % p;
  }

  // Handle negative results
  if (x3 < 0n) x3 += p;
  if (y3 < 0n) y3 += p;

  // Return uncompressed public key
  const xHex = x3.toString(16).padStart(64, '0');
  const yHex = y3.toString(16).padStart(64, '0');
  return '0x04' + xHex + yHex;
}

/**
 * Parse uncompressed public key to x,y coordinates
 */
function parseUncompressedPublicKey(pubKey: string): { x: bigint; y: bigint } {
  // Handle both compressed and uncompressed formats
  let hex = pubKey.startsWith('0x') ? pubKey.slice(2) : pubKey;

  if (hex.startsWith('04')) {
    // Uncompressed: 04 + x + y
    hex = hex.slice(2);
    const x = BigInt('0x' + hex.slice(0, 64));
    const y = BigInt('0x' + hex.slice(64, 128));
    return { x, y };
  } else if (hex.startsWith('02') || hex.startsWith('03')) {
    // Compressed: need to decompress
    const prefix = hex.slice(0, 2);
    const x = BigInt('0x' + hex.slice(2, 66));

    // y^2 = x^3 + 7 (mod p)
    const p = BigInt(
      '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F'
    );
    const ySquared = (x ** 3n + 7n) % p;
    let y = modPow(ySquared, (p + 1n) / 4n, p);

    // Choose correct y based on prefix
    const isEven = y % 2n === 0n;
    if ((prefix === '02' && !isEven) || (prefix === '03' && isEven)) {
      y = p - y;
    }

    return { x, y };
  }

  throw new Error('Invalid public key format');
}

/**
 * Modular multiplicative inverse using extended Euclidean algorithm
 */
function modInverse(a: bigint, m: bigint): bigint {
  a = ((a % m) + m) % m;
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }

  return ((old_s % m) + m) % m;
}

/**
 * Modular exponentiation
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Anonymous Buy Service
 *
 * Coordinates stealth addresses with ZkAMM for fully anonymous buying
 */
export class AnonymousBuyService {
  private stealthWallet: StealthWallet;
  private provider: ethers.Provider;

  constructor(seedPhrase: string, provider: ethers.Provider) {
    this.stealthWallet = new StealthWallet(seedPhrase);
    this.provider = provider;
  }

  /**
   * Get the stealth meta-address to share with senders
   */
  getReceiveAddress(): StealthMetaAddress {
    return this.stealthWallet.getMetaAddress();
  }

  /**
   * Generate a stealth address for self-funding
   * Use this when you want to fund yourself anonymously
   */
  generateSelfFundingAddress(): StealthAddress {
    return StealthWallet.generateStealthAddress(
      this.stealthWallet.getMetaAddress()
    );
  }

  /**
   * Get wallet for a stealth address we control
   */
  getStealthWallet(
    ephemeralPublicKey: string,
    provider: ethers.Provider
  ): ethers.Wallet {
    const spendingKey = this.stealthWallet.deriveStealthSpendingKey(ephemeralPublicKey);
    return new ethers.Wallet(spendingKey.privateKey, provider);
  }

  /**
   * Prepare anonymous buy transaction
   *
   * Flow:
   * 1. Generate stealth address for ourselves
   * 2. Return stealth data for funding
   * 3. After funding, caller uses getStealthWallet() to get spending wallet
   *
   * The stealth address breaks the link between:
   * - Funding source (public ETH from any address)
   * - Token recipient (private commitment in ZkAMM)
   */
  prepareAnonymousBuy(): {
    stealthAddress: string;
    ephemeralPublicKey: string;
    fundingInstructions: string;
  } {
    const stealth = this.generateSelfFundingAddress();

    return {
      stealthAddress: stealth.address,
      ephemeralPublicKey: stealth.ephemeralPublicKey,
      fundingInstructions: `
To complete anonymous buy:
1. Fund ${stealth.address} with ETH from any source
   - Use a fresh wallet
   - Or withdraw from exchange
   - Or use Tornado Cash/other mixer
2. Wait for funding confirmation
3. Call executeAnonymousBuy() with the ephemeral key
      `.trim(),
    };
  }

  /**
   * Execute buy from a funded stealth address
   */
  async executeFromStealth(
    ephemeralPublicKey: string,
    zkAmmContract: ethers.Contract,
    buyData: { commitment: bigint; minTokensOut: bigint; encryptedNote: string },
    ethAmount: bigint
  ): Promise<string> {
    // Get wallet for this stealth address
    const stealthWallet = this.getStealthWallet(ephemeralPublicKey, this.provider);

    // Check balance
    const balance = await this.provider.getBalance(stealthWallet.address);
    if (balance < ethAmount) {
      throw new Error(
        `Insufficient stealth address balance. Have: ${ethers.formatEther(balance)} ETH, need: ${ethers.formatEther(ethAmount)} ETH`
      );
    }

    // Execute buy
    const contractWithSigner = zkAmmContract.connect(stealthWallet) as ethers.Contract;
    const tx = await contractWithSigner.buyPrivate(
      buyData.commitment,
      buyData.minTokensOut,
      buyData.encryptedNote,
      { value: ethAmount }
    );

    const receipt = await tx.wait();
    return receipt?.hash || tx.hash;
  }
}
