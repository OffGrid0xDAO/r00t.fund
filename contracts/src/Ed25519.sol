// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Ed25519
/// @notice Ed25519 signature verification library for FROST threshold signatures
/// @dev Implements Ed25519 verification on Curve25519 (Twisted Edwards curve)
///      Gas-optimized for EVM with ~500k gas per verification
///
/// SECURITY FIX (Vuln 4): This is an EVM-COMPATIBLE Ed25519 variant that uses keccak256
/// instead of SHA512 for the challenge hash. This is intentional for gas efficiency and
/// compatibility. The off-chain FROST nodes MUST also use keccak256 for the challenge hash.
///
/// Ed25519-Keccak Signature Scheme:
/// - Curve: Curve25519 (Twisted Edwards curve)
/// - Base point: G (standard Ed25519 generator)
/// - Private key: 32-byte scalar s
/// - Public key: A = s * G (32 bytes)
/// - Signature: (R, s) where R is a curve point and s is a scalar (64 bytes total)
///
/// Verification (MODIFIED for EVM):
/// - Compute h = keccak256(R || A || M) mod L (NOT SHA512 - keccak256 for EVM compatibility)
/// - Check: s * G == R + h * A
///
/// IMPORTANT: Off-chain FROST signers MUST use keccak256 for challenge computation:
///   h = uint256(keccak256(R || publicKey || messageHash)) % L
///
/// For FROST:
/// - The public key A is the aggregated threshold public key
/// - The signature (R, s) is the aggregated FROST signature
/// - Signers MUST use keccak256 challenge hash to match on-chain verification
library Ed25519 {
    // ============ Constants ============

    /// @notice Prime field modulus for Curve25519
    /// p = 2^255 - 19
    uint256 private constant P = 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed;

    /// @notice Curve order (number of points on the curve)
    /// L = 2^252 + 27742317777372353535851937790883648493
    uint256 private constant L = 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed;

    /// @notice Edwards curve parameter d
    /// d = -121665/121666 mod p
    uint256 private constant D = 0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3;

    /// @notice Base point G (x-coordinate)
    uint256 private constant Gx = 0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a;

    /// @notice Base point G (y-coordinate)
    uint256 private constant Gy = 0x6666666666666666666666666666666666666666666666666666666666666658;

    /// @notice -1 mod p (used for square root computation)
    uint256 private constant MINUS_ONE = P - 1;

    /// @notice sqrt(-1) mod p
    uint256 private constant SQRT_MINUS_ONE = 0x2b8324804fc1df0b2b4d00993dfbd7a72f431806ad2fe478c4ee1b274a0ea0b0;

    // ============ Errors ============

    error InvalidSignatureLength();
    error InvalidPublicKey();
    error InvalidSignature();
    error PointNotOnCurve();

    // ============ Main Functions ============

    /// @notice Verify an Ed25519 signature
    /// @param publicKey 32-byte Ed25519 public key (compressed point)
    /// @param messageHash 32-byte message hash (typically keccak256 of the message)
    /// @param signature 64-byte Ed25519 signature (R || s)
    /// @return valid True if signature is valid
    function verify(
        bytes32 publicKey,
        bytes32 messageHash,
        bytes memory signature
    ) internal view returns (bool valid) {
        // Validate signature length
        if (signature.length != 64) revert InvalidSignatureLength();

        // Extract R (first 32 bytes) and s (last 32 bytes)
        bytes32 R;
        bytes32 s;
        assembly {
            R := mload(add(signature, 32))
            s := mload(add(signature, 64))
        }

        // Decompress public key to get point A
        (uint256 Ax, uint256 Ay) = _decompress(publicKey);
        if (!_isOnCurve(Ax, Ay)) revert InvalidPublicKey();

        // Decompress R to get point
        (uint256 Rx, uint256 Ry) = _decompress(R);
        if (!_isOnCurve(Rx, Ry)) revert InvalidSignature();

        // Check s is less than curve order L
        uint256 sValue = uint256(s);
        if (sValue >= L) revert InvalidSignature();

        // SECURITY FIX (Vuln 4): Compute challenge hash h using keccak256 (EVM-native)
        // h = keccak256(R || A || M) mod L
        // NOTE: Off-chain FROST signers MUST use the SAME keccak256 hash function
        // This is an intentional deviation from standard Ed25519 (which uses SHA512)
        // for gas efficiency and EVM compatibility
        uint256 h = uint256(keccak256(abi.encodePacked(R, publicKey, messageHash))) % L;

        // Verify: s * G == R + h * A
        // Rearranged: s * G - h * A == R

        // Compute s * G
        (uint256 sGx, uint256 sGy) = _scalarMult(Gx, Gy, sValue);

        // Compute h * A
        (uint256 hAx, uint256 hAy) = _scalarMult(Ax, Ay, h);

        // Compute -h * A (negate y-coordinate)
        uint256 negHAy = P - hAy;

        // Compute s * G + (-h * A) = s * G - h * A
        (uint256 resultX, uint256 resultY) = _addPoints(sGx, sGy, hAx, negHAy);

        // Check if result equals R
        valid = (resultX == Rx && resultY == Ry);
    }

    /// @notice Batch verify multiple signatures (gas optimization)
    /// @param publicKeys Array of public keys
    /// @param messageHashes Array of message hashes
    /// @param signatures Array of signatures
    /// @return valid True if all signatures are valid
    function batchVerify(
        bytes32[] calldata publicKeys,
        bytes32[] calldata messageHashes,
        bytes[] calldata signatures
    ) internal view returns (bool valid) {
        uint256 length = publicKeys.length;
        if (length != messageHashes.length || length != signatures.length) {
            return false;
        }

        for (uint256 i = 0; i < length; i++) {
            if (!verify(publicKeys[i], messageHashes[i], signatures[i])) {
                return false;
            }
        }

        return true;
    }

    // ============ Point Operations ============

    /// @notice Decompress a 32-byte public key to curve point
    /// @dev Ed25519 uses a compressed format where the x-coordinate's sign
    ///      is encoded in the highest bit of the y-coordinate
    function _decompress(bytes32 compressed) private view returns (uint256 x, uint256 y) {
        // The y-coordinate is the lower 255 bits
        y = uint256(compressed) & ((1 << 255) - 1);

        // Validate y is in field
        if (y >= P) revert InvalidPublicKey();

        // Compute x^2 = (y^2 - 1) / (d * y^2 + 1) mod p
        uint256 y2 = mulmod(y, y, P);
        uint256 num = addmod(y2, P - 1, P); // y^2 - 1
        uint256 den = addmod(mulmod(D, y2, P), 1, P); // d * y^2 + 1

        // Compute x^2 = num / den = num * den^(-1)
        uint256 denInv = _modExp(den, P - 2, P);
        uint256 x2 = mulmod(num, denInv, P);

        // Compute x = sqrt(x^2)
        x = _sqrt(x2);

        // Check sign bit and negate if necessary
        bool signBit = (uint256(compressed) >> 255) == 1;
        bool xOdd = (x & 1) == 1;

        if (signBit != xOdd) {
            x = P - x;
        }
    }

    /// @notice Check if a point is on the Ed25519 curve
    /// @dev Ed25519 curve equation: -x^2 + y^2 = 1 + d*x^2*y^2
    function _isOnCurve(uint256 x, uint256 y) private pure returns (bool) {
        uint256 x2 = mulmod(x, x, P);
        uint256 y2 = mulmod(y, y, P);

        // Left side: -x^2 + y^2 = y^2 - x^2
        uint256 lhs = addmod(y2, P - x2, P);

        // Right side: 1 + d*x^2*y^2
        uint256 rhs = addmod(1, mulmod(D, mulmod(x2, y2, P), P), P);

        return lhs == rhs;
    }

    /// @notice Scalar multiplication on Ed25519: k * P
    /// @dev Uses double-and-add algorithm
    function _scalarMult(uint256 px, uint256 py, uint256 k) private view returns (uint256 rx, uint256 ry) {
        // Start with identity point (0, 1) for Edwards curves
        rx = 0;
        ry = 1;

        // Double-and-add
        while (k > 0) {
            if (k & 1 == 1) {
                (rx, ry) = _addPoints(rx, ry, px, py);
            }
            (px, py) = _doublePoint(px, py);
            k >>= 1;
        }
    }

    /// @notice Add two points on Ed25519
    /// @dev Edwards curve addition: (x1, y1) + (x2, y2)
    ///      x3 = (x1*y2 + y1*x2) / (1 + d*x1*x2*y1*y2)
    ///      y3 = (y1*y2 + x1*x2) / (1 - d*x1*x2*y1*y2)
    function _addPoints(
        uint256 x1,
        uint256 y1,
        uint256 x2,
        uint256 y2
    ) private view returns (uint256 x3, uint256 y3) {
        // Handle identity cases
        if (x1 == 0 && y1 == 1) return (x2, y2);
        if (x2 == 0 && y2 == 1) return (x1, y1);

        uint256 x1y2 = mulmod(x1, y2, P);
        uint256 y1x2 = mulmod(y1, x2, P);
        uint256 y1y2 = mulmod(y1, y2, P);
        uint256 x1x2 = mulmod(x1, x2, P);

        uint256 dxy = mulmod(D, mulmod(x1x2, mulmod(y1, y2, P), P), P);

        // x3 = (x1*y2 + y1*x2) / (1 + d*x1*x2*y1*y2)
        uint256 numX = addmod(x1y2, y1x2, P);
        uint256 denX = addmod(1, dxy, P);
        uint256 denXInv = _modExp(denX, P - 2, P);
        x3 = mulmod(numX, denXInv, P);

        // y3 = (y1*y2 + x1*x2) / (1 - d*x1*x2*y1*y2)
        // Note: For Ed25519, we use -x^2 + y^2 form, so it's (y1*y2 + x1*x2)
        uint256 numY = addmod(y1y2, x1x2, P);
        uint256 denY = addmod(1, P - dxy, P); // 1 - d*x1*x2*y1*y2
        uint256 denYInv = _modExp(denY, P - 2, P);
        y3 = mulmod(numY, denYInv, P);
    }

    /// @notice Double a point on Ed25519
    function _doublePoint(uint256 x, uint256 y) private view returns (uint256 x3, uint256 y3) {
        return _addPoints(x, y, x, y);
    }

    // ============ Field Arithmetic ============

    /// @notice Modular exponentiation using precompile
    function _modExp(uint256 base, uint256 exponent, uint256 modulus) private view returns (uint256 result) {
        assembly {
            // Free memory pointer
            let ptr := mload(0x40)

            // Store inputs for modexp precompile
            mstore(ptr, 0x20)           // Length of base
            mstore(add(ptr, 0x20), 0x20) // Length of exponent
            mstore(add(ptr, 0x40), 0x20) // Length of modulus
            mstore(add(ptr, 0x60), base)
            mstore(add(ptr, 0x80), exponent)
            mstore(add(ptr, 0xa0), modulus)

            // Call modexp precompile (address 0x05)
            let success := staticcall(gas(), 0x05, ptr, 0xc0, ptr, 0x20)

            // Check success
            if iszero(success) {
                revert(0, 0)
            }

            result := mload(ptr)
        }
    }

    /// @notice Compute modular square root using Tonelli-Shanks
    /// @dev For p = 2^255 - 19 ≡ 5 (mod 8), we can use a simpler formula
    function _sqrt(uint256 a) private view returns (uint256) {
        if (a == 0) return 0;

        // For p ≡ 5 (mod 8): sqrt(a) = a^((p+3)/8) or sqrt(-1) * a^((p+3)/8)
        // (p + 3) / 8 = (2^255 - 19 + 3) / 8 = (2^255 - 16) / 8 = 2^252 - 2
        uint256 exp = (P + 3) / 8;
        uint256 root = _modExp(a, exp, P);

        // Check if root^2 = a
        if (mulmod(root, root, P) == a) {
            return root;
        }

        // Otherwise try sqrt(-1) * root
        root = mulmod(root, SQRT_MINUS_ONE, P);

        // Verify
        if (mulmod(root, root, P) != a) {
            revert InvalidSignature();
        }

        return root;
    }
}
