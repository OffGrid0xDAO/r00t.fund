#!/bin/bash

# Compile Circom circuits and generate proving artifacts
# Usage: ./scripts/compile-circuits.sh [circuit_name]
# If no circuit name provided, compiles all circuits

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CIRCUITS_DIR="$ROOT_DIR/circuits"
BUILD_DIR="$CIRCUITS_DIR/build"

# Helper function to capitalize first letter (works on older bash)
capitalize() {
    local str="$1"
    echo "$(echo "${str:0:1}" | tr '[:lower:]' '[:upper:]')${str:1}"
}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Create build directory
mkdir -p "$BUILD_DIR"

# Check dependencies
check_dependencies() {
    echo -e "${YELLOW}Checking dependencies...${NC}"

    if ! command -v circom &> /dev/null; then
        echo -e "${RED}Error: circom not found. Install with:${NC}"
        echo "  curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh"
        echo "  git clone https://github.com/iden3/circom.git"
        echo "  cd circom && cargo build --release && cargo install --path circom"
        exit 1
    fi

    if ! command -v snarkjs &> /dev/null; then
        echo -e "${RED}Error: snarkjs not found. Install with:${NC}"
        echo "  npm install -g snarkjs"
        exit 1
    fi

    echo -e "${GREEN}Dependencies OK${NC}"
}

# Download powers of tau if not exists
download_ptau() {
    local PTAU_FILE="$BUILD_DIR/powersOfTau28_hez_final_16.ptau"

    if [ ! -f "$PTAU_FILE" ]; then
        echo -e "${YELLOW}Downloading powers of tau (~100MB)...${NC}" >&2
        # Using snarkjs recommended source
        curl -L -o "$PTAU_FILE" \
            "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau"
    fi

    echo "$PTAU_FILE"
}

# Compile a single circuit
compile_circuit() {
    local CIRCUIT_NAME=$1
    local CIRCUIT_FILE="$CIRCUITS_DIR/$CIRCUIT_NAME.circom"
    local CIRCUIT_BUILD_DIR="$BUILD_DIR/$CIRCUIT_NAME"

    if [ ! -f "$CIRCUIT_FILE" ]; then
        echo -e "${RED}Error: Circuit file not found: $CIRCUIT_FILE${NC}"
        return 1
    fi

    echo -e "${YELLOW}Compiling $CIRCUIT_NAME...${NC}"
    mkdir -p "$CIRCUIT_BUILD_DIR"

    # Step 1: Compile circuit to R1CS
    echo "  [1/6] Compiling to R1CS..."
    circom "$CIRCUIT_FILE" \
        --r1cs \
        --wasm \
        --sym \
        -l "$CIRCUITS_DIR/node_modules" \
        -o "$CIRCUIT_BUILD_DIR"

    # Step 2: Get powers of tau
    echo "  [2/6] Getting powers of tau..."
    PTAU_FILE=$(download_ptau)

    # Step 3: Circuit-specific setup (phase 2)
    echo "  [3/6] Running circuit-specific setup..."
    snarkjs groth16 setup \
        "$CIRCUIT_BUILD_DIR/$CIRCUIT_NAME.r1cs" \
        "$PTAU_FILE" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0000.zkey"

    # Step 4: Contribute to phase 2 (for testing, use random entropy)
    echo "  [4/6] Contributing to phase 2..."
    echo "random entropy for testing" | snarkjs zkey contribute \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_0000.zkey" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
        --name="Test contribution" \
        -v

    # Step 5: Export verification key
    echo "  [5/6] Exporting verification key..."
    snarkjs zkey export verificationkey \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_verification_key.json"

    # Step 6: Generate Solidity verifier
    local CAPITALIZED_NAME=$(capitalize "$CIRCUIT_NAME")
    echo "  [6/6] Generating Solidity verifier..."
    snarkjs zkey export solidityverifier \
        "$CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
        "$CIRCUIT_BUILD_DIR/${CAPITALIZED_NAME}Verifier.sol"

    echo -e "${GREEN}✓ $CIRCUIT_NAME compiled successfully${NC}"
    echo "  R1CS: $CIRCUIT_BUILD_DIR/$CIRCUIT_NAME.r1cs"
    echo "  WASM: $CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_js/$CIRCUIT_NAME.wasm"
    echo "  ZKEY: $CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_final.zkey"
    echo "  VKEY: $CIRCUIT_BUILD_DIR/${CIRCUIT_NAME}_verification_key.json"
    echo "  SOL:  $CIRCUIT_BUILD_DIR/${CAPITALIZED_NAME}Verifier.sol"
}

# All circuit names (8 circuits total)
ALL_CIRCUITS=("sell" "transfer" "withdraw" "vote" "swap" "addLiquidity" "removeLiquidity" "claimLPFees")

# Main
main() {
    check_dependencies

    if [ $# -eq 0 ]; then
        # Compile all circuits
        echo -e "${YELLOW}Compiling all circuits...${NC}"
        for circuit in "${ALL_CIRCUITS[@]}"; do
            if [ -f "$CIRCUITS_DIR/$circuit.circom" ]; then
                compile_circuit "$circuit"
            else
                echo -e "${YELLOW}Skipping $circuit (not found)${NC}"
            fi
        done
    else
        # Compile specified circuit
        compile_circuit "$1"
    fi

    # Copy verifiers to contracts directory
    echo -e "${YELLOW}Copying verifiers to contracts/src/verifiers/...${NC}"
    mkdir -p "$ROOT_DIR/contracts/src/verifiers"

    for circuit in "${ALL_CIRCUITS[@]}"; do
        local CAP_NAME=$(capitalize "$circuit")
        local VERIFIER="$BUILD_DIR/$circuit/${CAP_NAME}Verifier.sol"
        if [ -f "$VERIFIER" ]; then
            # Rename verifier contract to avoid conflicts
            sed -i.bak "s/contract Groth16Verifier/contract ${CAP_NAME}Groth16Verifier/g" "$VERIFIER"
            rm -f "$VERIFIER.bak"
            cp "$VERIFIER" "$ROOT_DIR/contracts/src/verifiers/"
            echo "  Copied ${CAP_NAME}Verifier.sol"
        fi
    done

    echo -e "${GREEN}Done!${NC}"
    echo ""
    echo "Circuit artifacts available at:"
    echo "  $BUILD_DIR/"
    echo ""
    echo "Solidity verifiers copied to:"
    echo "  $ROOT_DIR/contracts/src/verifiers/"
}

main "$@"
