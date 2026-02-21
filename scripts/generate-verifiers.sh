#!/bin/bash

# Generate Solidity verifier contracts from compiled circuits
# Usage: ./scripts/generate-verifiers.sh [circuit_name]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT_DIR/circuits/build"
VERIFIERS_DIR="$ROOT_DIR/contracts/src/verifiers"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Create verifiers directory
mkdir -p "$VERIFIERS_DIR"

# Generate verifier for a circuit
generate_verifier() {
    local CIRCUIT_NAME=$1
    local ZKEY_FILE="$BUILD_DIR/$CIRCUIT_NAME/${CIRCUIT_NAME}_final.zkey"
    local OUTPUT_FILE="$VERIFIERS_DIR/${CIRCUIT_NAME^}Verifier.sol"

    if [ ! -f "$ZKEY_FILE" ]; then
        echo -e "${RED}Error: ZKEY file not found: $ZKEY_FILE${NC}"
        echo "Run ./scripts/compile-circuits.sh $CIRCUIT_NAME first"
        return 1
    fi

    echo -e "${YELLOW}Generating verifier for $CIRCUIT_NAME...${NC}"

    # Generate Solidity verifier
    snarkjs zkey export solidityverifier \
        "$ZKEY_FILE" \
        "$OUTPUT_FILE"

    # Post-process: update Solidity version and contract name
    local PASCAL_NAME="${CIRCUIT_NAME^}Verifier"

    # macOS and Linux compatible sed
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/pragma solidity \^0.6.11;/pragma solidity ^0.8.24;/" "$OUTPUT_FILE"
        sed -i '' "s/contract Groth16Verifier/contract $PASCAL_NAME/" "$OUTPUT_FILE"
    else
        # Linux
        sed -i "s/pragma solidity \^0.6.11;/pragma solidity ^0.8.24;/" "$OUTPUT_FILE"
        sed -i "s/contract Groth16Verifier/contract $PASCAL_NAME/" "$OUTPUT_FILE"
    fi

    echo -e "${GREEN}✓ Generated: $OUTPUT_FILE${NC}"
}

# Main
main() {
    if ! command -v snarkjs &> /dev/null; then
        echo -e "${RED}Error: snarkjs not found. Install with: npm install -g snarkjs${NC}"
        exit 1
    fi

    if [ $# -eq 0 ]; then
        # Generate all verifiers
        echo -e "${YELLOW}Generating all verifiers...${NC}"
        generate_verifier "sell"
        generate_verifier "transfer"
    else
        # Generate specified verifier
        generate_verifier "$1"
    fi

    echo -e "${GREEN}Done!${NC}"
}

main "$@"
