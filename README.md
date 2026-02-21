<div align="center">

# 🌳 R00t.fund

### The Private Launchpad for Regenerative Projects

**Regenerating land. Verifying impact. Preserving privacy.**

*A zero-knowledge DeFi protocol where communities fund regeneration projects through private governance,*
*and Chainlink CRE proves whether those projects actually delivered — from satellite imagery to carbon credits.*

<br/>

[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=for-the-badge&logo=solidity&logoColor=white)](https://soliditylang.org/)
[![Chainlink](https://img.shields.io/badge/Chainlink-CRE-375BD2?style=for-the-badge&logo=chainlink&logoColor=white)](https://chain.link/)
[![Foundry](https://img.shields.io/badge/Foundry-Build-F7B93E?style=for-the-badge&logo=ethereum&logoColor=black)](https://book.getfoundry.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Circom](https://img.shields.io/badge/Circom-ZK--SNARKs-8B5CF6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyTDIgNy41VjE2LjVMMTIgMjJMMjIgMTYuNVY3LjVMMTIgMloiLz48L3N2Zz4=&logoColor=white)](https://docs.circom.io/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Viem](https://img.shields.io/badge/Viem-EVM-1C1C1C?style=for-the-badge&logo=ethereum&logoColor=white)](https://viem.sh/)
[![Tailwind](https://img.shields.io/badge/Tailwind-CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

<br/>

[![Sepolia](https://img.shields.io/badge/Network-Sepolia-6C47FF?style=flat-square&logo=ethereum&logoColor=white)](#)
[![Tenderly](https://img.shields.io/badge/Tenderly-Virtual_TestNet-6F4FF2?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyTDIgNy41VjE2LjVMMTIgMjJMMjIgMTYuNVY3LjVMMTIgMloiLz48L3N2Zz4=&logoColor=white)](#tenderly-virtual-testnet)
[![x402](https://img.shields.io/badge/x402-Payments-0052FF?style=flat-square&logo=coinbase&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](#)
[![CRE Workflows](https://img.shields.io/badge/CRE_Workflows-7-375BD2?style=flat-square&logo=chainlink&logoColor=white)](#)
[![Smart Contracts](https://img.shields.io/badge/Contracts-15+-363636?style=flat-square&logo=solidity&logoColor=white)](#)
[![ZK Circuits](https://img.shields.io/badge/ZK_Circuits-5-8B5CF6?style=flat-square)](#)

<br/>

*Built in Portugal 🇵🇹 · Verified by Chainlink · Rooted in the earth*

</div>

---

**Built for the Chainlink CRE Hackathon** — Competing across all prize tracks

| Track | Our Submission |
|-------|---------------|
| Privacy | Confidential carbon credit verification + Chainlink ACE compliant private transfers |
| DeFi & Tokenization | Regenerative Proof of Reserve with carbon-backed TVL |
| CRE & AI | AI land regeneration validator using satellite imagery |
| Prediction Markets | Environmental outcome markets with CRE-automated settlement |
| Risk & Compliance | Real-time protocol health monitor with circuit breakers |
| **Tenderly** | **Full protocol deployed on Tenderly Virtual TestNet — 27+ contracts, 7 CRE workflows, simulated transactions** |
| Top 10 | 7 integrated CRE workflows across entire protocol |

---

## What is R00t.fund?

R00t.fund is a **private launchpad for regenerative projects**. Anyone can propose a project — reforestation, soil restoration, watershed recovery, biodiversity corridors — and the community funds it through privacy-preserving governance. But unlike traditional launchpads, **the projects must prove their impact to unlock funding milestones**.

This is the full lifecycle:

### 1. Launch — Private Governance

A project proposer submits to `LaunchpadGovernanceV2` with coordinates, species lists, target outcomes, and a funding schedule. Community members vote using ZK-SNARK proofs — their identity, vote weight, and voting direction remain private. If the proposal passes, funding is committed to `ConfidentialFundingVault`.

### 2. Fund — Zero-Knowledge AMM

Funding flows through `ZkAMMv3`, a full-featured AMM where every operation is private:

- **Private deposits** — ETH enters the privacy pool via Poseidon commitments in a Merkle tree (depth 24, ~16M leaves)
- **Private swaps** — Buy and sell ROOT tokens without revealing your address or trade size
- **Private LP** — Provide liquidity and earn fees without exposing your position
- **Private transfers** — Send tokens peer-to-peer with ZK proofs
- **Short selling** — Hedge against project token price via `R00TShorts` with full collateral management

Each project launched through governance gets its own token, tradeable on the ZkAMM with the same privacy guarantees.

### 3. Verify — Chainlink CRE as the Compliance & Verification Layer

This is where Chainlink CRE transforms the protocol. Instead of trusting project teams to self-report their impact, **Chainlink's decentralized oracle network independently verifies whether each project reached its goals**:

- **Satellite imagery** (Copernicus Sentinel-2) measures vegetation recovery via NDVI
- **Soil data** (ISRIC SoilGrids) tracks organic carbon accumulation
- **Forest monitoring** (Global Forest Watch) confirms tree cover changes
- **AI analysis** (LLM via ConfidentialHTTPClient) provides holistic MRV assessment
- **Carbon registries** (Verra, Gold Standard) cross-reference credit claims
- **Portuguese regulatory bodies** (APA, ICNF, Fundo Ambiental) validate compliance

If the project meets its targets, the next funding milestone is released. If it doesn't, the community knows — and prediction markets (W4) can price the risk.

### 4. Comply — Privacy with Regulatory Compliance

The Chainlink ACE (Anonymous Compliant Exchange) pattern ensures that privacy and compliance coexist. The `R00tPolicyEngine` stores compliance attestations using address hashes (never raw addresses), and the CRE DON checks sanctions lists and EU MiCA requirements via encrypted API calls before authorizing any private transfer.

Result: institutional capital can participate in regenerative project funding while meeting EU MiCA, Portuguese CMVM, and FATF requirements — without sacrificing the privacy that makes the protocol work.

### 5. Trade — Carbon Credits with Real Backing

Verified projects generate carbon credit attestations that feed into the Portuguese Mercado Voluntario de Carbono and EU ETS. The `RegenProofOfReserve` data feed includes these carbon credits in the protocol's TVL, making the reserves transparently backed by both crypto assets and verified environmental impact.

---

## The Problem

### The money never reaches the ground

Every year, billions of euros flow into carbon credit markets and reforestation programmes. The vast majority never reaches the people actually planting trees, restoring soil, or managing watersheds. It gets absorbed by intermediaries — brokers, certifiers, consultants, fund administrators, NGO overhead layers — each taking a cut before anything touches the earth. A landowner in Serra da Estrela who plants 2,550 native oaks on burned hillside sees a fraction of what a carbon credit buyer paid. Sometimes nothing at all.

This is not an edge case. Studies consistently show that **60–80% of climate finance is consumed by intermediary costs** before reaching implementation. In the voluntary carbon market, a credit sold for €25 might deliver €3–5 to the person who actually restored the land. The rest disappears into verification fees, brokerage commissions, registry costs, consultancy reports, and administrative overhead across a chain of middlemen who never touched soil.

### No one checks if the land actually recovered

The registries that are supposed to guarantee quality — Verra, Gold Standard, Plan Vivo — rely on **self-reported data** from project developers who have every incentive to overstate results. Buyers cannot independently confirm that a forest was planted, that soil carbon increased, or that a burned landscape is recovering. There is no oracle. There is no satellite feed anyone can query. There is no on-chain proof.

The result: phantom credits flood the market. Projects claim carbon sequestration from forests that were never planted, or double-count credits across multiple registries. The 2023 Guardian/Die Zeit/SourceMaterial investigation found that over 90% of Verra's rainforest offset credits likely did not represent genuine carbon reductions.

### Privacy and compliance are treated as opposites

Privacy-preserving DeFi protocols operate in regulatory grey zones — offering anonymity without compliance, making them unusable for institutional capital that needs to meet EU MiCA and Portuguese CMVM requirements. Meanwhile, compliant platforms strip away all privacy, exposing funders to front-running, social pressure, and competitive intelligence leaks.

This creates a deadlock: the institutions with capital to fund regeneration at scale cannot use private protocols, and the private protocols that could protect small landowners and local communities cannot attract institutional capital.

### Launchpads have no accountability

Traditional launchpads and crowdfunding platforms have no mechanism to verify whether funded projects deliver. A project raises capital and the relationship ends. There is no oracle checking whether the funded reforestation actually happened, no milestone-gated release, no automated consequence for failure.

---

**R00t.fund solves all four problems:**

1. **Direct funding** — Smart contracts send funds directly to project implementers. No brokers, no intermediaries, no administrative overhead. The person planting trees on burned hillside in Serra da Estrela receives the funds, not a chain of middlemen. Governance is community-driven and privacy-preserving — the people closest to the land decide where capital goes.

2. **Independent verification** — Chainlink CRE queries Copernicus Sentinel-2 satellite imagery, ISRIC SoilGrids, Global Forest Watch, and AI analysis to independently confirm whether land is actually regenerating. No self-reporting. No trust assumptions. The DON checks the satellite feed and publishes the result on-chain for anyone to read.

3. **Privacy with compliance** — ZK-SNARK commitments keep all transactions private while Chainlink ACE ensures regulatory compliance via encrypted sanctions screening and EU MiCA checks. Institutional capital can flow into regenerative projects without sacrificing the privacy that protects small landowners and local communities.

4. **Milestone-gated accountability** — Funding is released in tranches, gated by verified impact attestations. If the CRE DON cannot confirm that the project reached its target NDVI recovery, soil carbon threshold, or tree survival rate — the next tranche stays locked. No verification, no funds.

---

## Real Project: Serra da Estrela Native Forest Restoration

This is not a hypothetical. After the **2025 summer fires** devastated Serra da Estrela Natural Park in Portugal, we are reforesting **9 hectares** with native Iberian species:

| Species | Portuguese Name | Trees Planted | CO2/tree/year |
|---------|----------------|:------------:|:-------------:|
| *Quercus robur* | Carvalho-roble | 800 | 22 kg |
| *Quercus pyrenaica* | Carvalho-negral | 600 | 18 kg |
| *Castanea sativa* | Castanheiro | 400 | 25 kg |
| *Crataegus monogyna* | Espinheiro / Pilriteiro | 300 | 8 kg |
| *Prunus spinosa* | Abrunheiro | 200 | 6 kg |
| *Arbutus unedo* | Medronheiro | 150 | 12 kg |
| *Fraxinus angustifolia* | Freixo | 100 | 15 kg |
| | **Total** | **2,550** | |

**Location:** 40.3228°N, 7.6114°W — Seia, Serra da Estrela Natural Park, Portugal
**Fire date:** July 2025 | **Planting began:** November 2025
**ICNF Reference:** PRRF-SE-2025-0042

A dedicated Chainlink CRE Custom Data Feed ([Workflow 7](#workflow-7-serra-da-estrela-data-feed)) publishes the restoration's NDVI recovery, fire scar healing, tree survival estimates, and carbon sequestration on-chain every 6 hours as an AggregatorV3Interface-compatible feed.

---

## How Chainlink CRE Verifies Project Goals

Every project launched through R00t.fund governance goes through the same verification pipeline. Chainlink CRE acts as the independent auditor that determines whether a project delivered what it promised.

```
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                        PROJECT VERIFICATION LIFECYCLE                        │
 │                                                                              │
 │  PROPOSE          FUND             VERIFY              ATTEST                │
 │  ────────►   ────────────►   ──────────────────►   ──────────────►          │
 │                                                                              │
 │  Community        ZkAMM             Chainlink CRE         On-chain           │
 │  votes via        commits           checks:               attestation        │
 │  ZK governance    ETH to            • Satellite NDVI      stored in          │
 │  (private)        Confidential      • Soil carbon         Confidential       │
 │                   Funding           • Tree cover           FundingVault      │
 │                   Vault             • AI analysis                            │
 │                   (escrowed)        • Carbon registry                        │
 │                                     • PT MVC compliance                      │
 │                                                                              │
 │                                         │                                    │
 │                                         ▼                                    │
 │                                   ┌───────────┐                              │
 │                                   │ VERIFIED?  │                              │
 │                                   └─────┬─────┘                              │
 │                                    YES  │  NO                                │
 │                                   ┌─────┴─────┐                              │
 │                                   ▼           ▼                              │
 │                            Next funding    Funds remain                      │
 │                            milestone       locked until                      │
 │                            released        targets are met                   │
 │                                   │                                          │
 │                                   ▼                                          │
 │                            Carbon credits                                    │
 │                            attributed via                                    │
 │                            PT MVC / EU ETS                                   │
 └──────────────────────────────────────────────────────────────────────────────┘
```

**This is the key insight:** Chainlink CRE is not just an oracle for R00t.fund — it is the accountability mechanism that makes the entire launchpad trustworthy. Projects cannot claim impact without independent verification. Funding cannot be released without proof. Carbon credits cannot be attributed without multi-source environmental data consensus.

The same verification pipeline works for any type of regenerative project:

| Project Type | What CRE Verifies | Data Sources |
|-------------|-------------------|-------------|
| Reforestation | NDVI recovery, tree survival, canopy cover | Sentinel-2, Global Forest Watch |
| Soil restoration | Organic carbon increase, moisture levels | ISRIC SoilGrids, in-situ sensors |
| Watershed recovery | Water quality, flow rates, riparian cover | Copernicus Water, local gauges |
| Biodiversity corridors | Species counts, habitat connectivity | eBird, GBIF, camera trap APIs |
| Fire recovery | dNBR burn scar healing, regrowth rate | Sentinel-2 SWIR, EFFIS |
| Mangrove restoration | Coastal coverage, blue carbon | Sentinel-2, Global Mangrove Watch |

---

## Architecture

```
                                    CHAINLINK CRE DON
                                    ┌─────────────────────────────────────────┐
                                    │                                         │
                                    │  W1: Carbon Credit Verification         │
                                    │  W2: Proof of Reserve                   │
                                    │  W3: AI Land Regeneration Validator     │
                                    │  W4: Prediction Market Settlement       │
                                    │  W5: Protocol Health Monitor            │
                                    │  W6: Compliant Private Transfers (ACE)  │
                                    │  W7: Serra da Estrela Data Feed         │
                                    │                                         │
                                    └──────────┬──────────────────────────────┘
                                               │
                         ConfidentialHTTPClient │ EVMClient
                         (encrypted API keys)   │ (eth_call + writeReport)
                                               │
              ┌────────────────────────────────┼──────────────────────────────┐
              │                                │                              │
              ▼                                ▼                              ▼
    ┌─────────────────┐          ┌──────────────────────┐         ┌────────────────────┐
    │ External APIs   │          │  On-Chain Contracts   │         │  Privacy Layer     │
    │                 │          │                       │         │                    │
    │ Copernicus      │          │ ConfidentialFunding   │         │ ZkAMMv3Pair        │
    │  Sentinel-2     │          │  Vault (W1)           │         │  TokenPool (Merkle)│
    │ ISRIC SoilGrids │          │ RegenProofOfReserve   │         │  Poseidon T3 hash  │
    │ Global Forest   │          │  (W2)                 │         │  Nullifier Registry│
    │  Watch          │          │ AIAgentOrchestrator   │         │                    │
    │ Verra VCS       │          │  (W3)                 │         │ CompliantPrivate   │
    │ Gold Standard   │          │ RegenPrediction       │         │  Vault (ACE)       │
    │ APA / CELE      │          │  Market (W4)          │         │ R00tPolicyEngine   │
    │ Fundo Ambiental │          │ ProtocolHealth        │         │                    │
    │ IPMA Weather    │          │  Monitor (W5)         │         │ ZK Circuits:       │
    │ OFAC / EU       │          │ SerraEstrela          │         │  sell, transfer,   │
    │  Sanctions      │          │  NativeForest (W7)    │         │  merge, withdraw,  │
    │ Chainalysis     │          │                       │         │  addLiquidity, ... │
    └─────────────────┘          └──────────────────────┘         └────────────────────┘
                                               │
                                               ▼
                                 ┌──────────────────────────┐
                                 │  Frontend / Agents        │
                                 │                           │
                                 │ React + Tailwind UI       │
                                 │ Trading Agents (6 strats) │
                                 │ SDK (13 modules)          │
                                 │ Ponder Indexer             │
                                 │ MCP Servers (3)            │
                                 └──────────────────────────┘
```

---

## Portuguese Carbon Market Integration

R00t.fund is designed from the ground up for interoperability with the **Mercado Voluntario de Carbono** (Portuguese Voluntary Carbon Market) and the broader EU carbon framework.

### Regulatory Framework

| Registry / Authority | Integration Point | CRE Workflow |
|---------------------|-------------------|:------------:|
| **APA** — Agencia Portuguesa do Ambiente | Project registration & MVC compliance | W1 |
| **Fundo Ambiental** | Co-financing eligibility verification | W1 |
| **CELE** — Comercio Europeu de Licencas de Emissao | EU ETS compliance checking | W1 |
| **RNBC 2050** — Roteiro para a Neutralidade Carbonica | Alignment with Portugal's 2050 roadmap | W1 |
| **ICNF** — Instituto da Conservacao da Natureza | Forest restoration project registry | W7 |
| **IPMA** — Instituto Portugues do Mar e da Atmosfera | Weather data for restoration monitoring | W7 |
| **CMVM** — Comissao do Mercado de Valores Mobiliarios | Crypto-asset compliance (MiCA) | W6 |
| **Verra VCS** | International carbon credit verification | W1 |
| **Gold Standard** | Premium carbon credit validation | W1 |
| **EU ETS** | EUA price reference & compliance | W1, W2 |
| **SENDECO2** | Iberian market carbon pricing | W1, W2 |
| **Article 6, Paris Agreement** | Corresponding adjustment verification | W1 |

### How Carbon Credits Flow

```
  Reforestation Project (Serra da Estrela)
           │
           ▼
  CRE W7: Satellite monitoring (NDVI, dNBR, SOC)
           │
           ▼
  CRE W3: AI verification — "Is this project genuinely regenerating?"
           │
           ▼
  CRE W1: Carbon credit attribution
           ├── Verra VCS verification (ConfidentialHTTPClient)
           ├── Gold Standard validation (ConfidentialHTTPClient)
           ├── APA/MVC registration check
           ├── EU ETS price reference
           ├── Article 6 double-counting prevention
           │
           ▼
  On-chain: ConfidentialFundingVault stores encrypted attestation
           │
           ▼
  CRE W2: Proof of Reserve includes carbon credit value in TVL
           │
           ▼
  Carbon credits become tradeable through ZkAMM with privacy
```

### Impact Scoring

Each project receives a composite impact score (0-1000) computed from:

| Component | Weight | Source | Max Points |
|-----------|:------:|--------|:----------:|
| Registry verification (Verra/GS) | 20% | ConfidentialHTTPClient | 200 |
| Portuguese MVC compliance | 15% | APA/Fundo Ambiental APIs | 150 |
| Verified tCO2e credits | 20% | Registry cross-reference | 200 |
| SDG alignment | 15% | Project metadata analysis | 150 |
| EU MRV compliance | 20% | CELE + Article 6 check | 200 |
| Permanence assessment | 10% | Historical + projection | 100 |

---

## Chainlink CRE Workflows

### Workflow 1: Confidential Carbon Credit Verification

**Prize Track:** Privacy ($16,000)
**File:** [`cre-workflows/workflow-1-privacy/main.ts`](cre-workflows/workflow-1-privacy/main.ts)
**Contract:** [`contracts/src/cre/ConfidentialFundingVault.sol`](contracts/src/cre/ConfidentialFundingVault.sol)

Uses `ConfidentialHTTPClient` with encrypted API credentials (DON vault secrets) to query carbon registries. The API keys for Verra, Gold Standard, and APA never leave the CRE enclave.

**What it does:**
1. Reads executed proposals from `LaunchpadGovernanceV2` via `EVMClient`
2. Queries Verra VCS Registry via `ConfidentialHTTPClient` (encrypted API key)
3. Queries Gold Standard Registry via `ConfidentialHTTPClient`
4. Fetches EU ETS EUA price + SENDECO2 Iberian market price
5. Checks Portuguese MVC: APA registration, CELE compliance, RNBC 2050 alignment, Fundo Ambiental eligibility
6. Verifies EU MRV compliance + Article 6 double-counting prevention
7. Computes composite impact score (0-1000)
8. Encrypts full attestation and pushes on-chain with `encryptOutput: true`

**Key CRE patterns:** `ConfidentialHTTPClient`, `vaultDonSecrets`, `consensusIdenticalAggregation`, encrypted output

---

### Workflow 2: Regenerative Proof of Reserve

**Prize Track:** DeFi & Tokenization ($20,000)
**File:** [`cre-workflows/workflow-2-defi/main.ts`](cre-workflows/workflow-2-defi/main.ts)
**Contract:** [`contracts/src/cre/RegenProofOfReserve.sol`](contracts/src/cre/RegenProofOfReserve.sol)

A Chainlink-compatible Proof of Reserve data feed where **TVL includes verified carbon credit value**. This is what makes it a "Regenerative" PoR — the protocol's reserves are backed not just by ETH and tokens, but by audited environmental impact.

**What it does:**
1. Reads on-chain reserves from `ZkAMMv3Pair` (ethReserve, tokenReserve, totalLPShares)
2. Reads shorts collateral from `R00TShorts` (totalOpenInterest, totalCollateralLocked)
3. Reads verified carbon credits from W1's `ConfidentialFundingVault` attestations
4. Fetches carbon prices from EU ETS, SENDECO2, ClimateTrade, Toucan BCT
5. Computes: `Total TVL = ETH reserve + shorts collateral + verified carbon credit value`
6. Publishes via `AggregatorV3Interface` (latestRoundData) for standard Chainlink consumption

**Key CRE patterns:** `HTTPClient`, `EVMClient.callContract`, `ConsensusAggregationByFields` + `median`, `AggregatorV3Interface`

---

### Workflow 3: AI Land Regeneration Validator

**Prize Track:** CRE & AI ($17,000)
**File:** [`cre-workflows/workflow-3-ai/main.ts`](cre-workflows/workflow-3-ai/main.ts)
**Contract:** [`contracts/src/cre/AIAgentOrchestrator.sol`](contracts/src/cre/AIAgentOrchestrator.sol)

The core differentiator. Uses real environmental data APIs + LLM analysis to determine whether a project launched through governance is **actually regenerating land**.

**Data pipeline:**

| Step | Data Source | What It Measures |
|------|-----------|------------------|
| 1 | Copernicus Sentinel-2 (B04/B08 bands) | NDVI — vegetation health index |
| 2 | ISRIC SoilGrids (0-30cm depth) | Soil organic carbon (tonnes C/ha) |
| 3 | Global Forest Watch | Tree canopy cover + change |
| 4 | CORINE Land Cover | EU land classification |
| 5 | LLM via ConfidentialHTTPClient | Holistic MRV analysis |

The LLM receives all environmental evidence and returns a structured verification:
- `verificationStatus`: REGENERATING / STABLE / DEGRADING / INSUFFICIENT_DATA
- `regenerationScore`: 0-1000
- `estimatedCarbonSequestration`: tonnes CO2e/year
- `carbonCreditEligible`: true/false
- `euRegistryCompatible`: true/false

**Key CRE patterns:** `ConfidentialHTTPClient` (LLM API with encrypted key), `EVMClient`, heuristic fallback if LLM unavailable

---

### Workflow 4: Regenerative Outcome Markets

**Prize Track:** Prediction Markets ($16,000)
**File:** [`cre-workflows/workflow-4-prediction/main.ts`](cre-workflows/workflow-4-prediction/main.ts)
**Contract:** [`contracts/src/cre/RegenPredictionMarket.sol`](contracts/src/cre/RegenPredictionMarket.sol)

Prediction markets for environmental milestones: "Will project X achieve 50% NDVI recovery by Q4 2026?" Markets are created linked to governance proposals and settled automatically by CRE when the outcome data is available.

**What it does:**
1. Listens for `ResolutionRequested` events via `EVMClient.logTrigger`
2. Fetches environmental outcome data from 3+ sources (Gold Standard, Verra, environmental monitors)
3. Achieves consensus via `median` across DON nodes
4. Determines `actualValue >= targetValue ? POSITIVE : NEGATIVE`
5. Pushes resolution on-chain — contract distributes payouts

**Key CRE patterns:** `evmLogTrigger`, `HTTPClient`, `ConsensusAggregationByFields`, multi-source verification

---

### Workflow 5: Protocol Health Monitor

**Prize Track:** Risk & Compliance ($16,000)
**File:** [`cre-workflows/workflow-5-risk/main.ts`](cre-workflows/workflow-5-risk/main.ts)
**Contract:** [`contracts/src/cre/ProtocolHealthMonitor.sol`](contracts/src/cre/ProtocolHealthMonitor.sol)

Real-time monitoring of the entire protocol stack — reserves, shorts utilization, LP health — with automatic circuit breaker triggers.

**What it does (every 60 seconds):**
1. Reads `ZkAMMv3Pair`: ethReserve, tokenReserve, totalLPShares, fees
2. Reads `R00TShorts`: totalOpenInterest, totalCollateralLocked, liquidatable positions
3. Computes: reserve ratio, shorts utilization, composite risk score (0-100)
4. Maps to risk levels: LOW / MODERATE / HIGH / CRITICAL
5. Pushes health report on-chain
6. If CRITICAL: contract can trigger auto circuit breaker via `ZkAMMv3Admin`

**Key CRE patterns:** `CronCapability` (60s), `EVMClient.callContract`, multi-contract reads, automated risk response

---

### Workflow 6: Compliant Private Transfers (Chainlink ACE)

**Prize Track:** Privacy ($16,000)
**File:** [`cre-workflows/workflow-6-compliance/main.ts`](cre-workflows/workflow-6-compliance/main.ts)
**Contracts:** [`R00tPolicyEngine.sol`](contracts/src/cre/R00tPolicyEngine.sol), [`CompliantPrivateVault.sol`](contracts/src/cre/CompliantPrivateVault.sol)

Adapts the **Chainlink ACE (Anonymous Compliant Exchange)** pattern for R00t.fund's ZK-SNARK privacy system. Users get privacy AND regulatory compliance — simultaneously.

**How it works:**

```
User sends ETH to CompliantPrivateVault.requestDeposit()
  → Emits PrivateTransferRequested event
  → CRE W6 detects event

CRE W6:
  1. EVMClient.callContract() → PolicyEngine.checkPrivateTransferAllowed()
     - Checks compliance level (BASIC/STANDARD/ENHANCED/INSTITUTIONAL)
     - Checks daily volume limits
     - Checks risk score
     - Checks jurisdiction (32 EU/EEA countries pre-approved)

  2. ConfidentialHTTPClient → Sanctions screening
     - OFAC SDN list (encrypted API key)
     - Chainalysis risk scoring (encrypted API key)
     - EU consolidated sanctions list

  3. ConfidentialHTTPClient → Regulatory compliance
     - EU MiCA compliance (ESMA)
     - Portuguese CMVM registry

  4. If ALL checks pass:
     → authorizeTransfer() → insertCommitmentFromCRE() → ZK Merkle tree
     (commitment is now private, spendable with ZK proof)

  5. If ANY check fails:
     → denyTransfer(reason) → ETH refunded to user
```

**Privacy model:**
- Only address hashes (`keccak256(address, salt)`) used for compliance — never raw addresses
- Sanctions APIs queried with encrypted credentials inside DON enclave
- On-chain: only sees "authorized" or "denied" — no identity linkage
- Once committed, tokens are fully private (ZK-SNARK spend via nullifier proofs)

**Key CRE patterns:** `evmLogTrigger`, `ConfidentialHTTPClient`, `EVMClient.callContract` (eth_call for policy check), `vaultDonSecrets`

---

### Workflow 7: Serra da Estrela Data Feed

**Prize Track:** Custom Data Feed (DeFi track)
**File:** [`cre-workflows/workflow-7-serra-estrela/main.ts`](cre-workflows/workflow-7-serra-estrela/main.ts)
**Contract:** [`contracts/src/cre/SerraEstrelaNativeForest.sol`](contracts/src/cre/SerraEstrelaNativeForest.sol)

A dedicated `AggregatorV3Interface`-compatible data feed for our real reforestation project. Published every 6 hours.

**Data published on-chain:**

| Metric | Source | On-chain Field |
|--------|--------|---------------|
| Current NDVI | Copernicus Sentinel-2 (B04/B08) | `ndviCurrent` (x10000) |
| Pre-fire NDVI | Sentinel-2 (June 2025) | `ndviPreFire` (x10000) |
| NDVI Recovery % | Computed | `ndviRecoveryPct` (x100) |
| dNBR (burn severity) | Sentinel-2 (B08/B12 SWIR) | `dnbr` (x10000) |
| Soil Organic Carbon | ISRIC SoilGrids | `soilOrganicCarbon` (tC/ha x100) |
| Estimated Live Trees | NDVI micro-analysis + species model | `estimatedLiveTrees` |
| Annual CO2 Sequestration | Species × growth stage × survival | `annualCO2` (tCO2e x1000) |
| Carbon Credits | 80% of estimated (buffer pool) | `carbonCredits` (tCO2e x1000) |
| Fire Recovery Index | Weighted composite (0-1000) | `fireRecoveryIndex` |

**Fire Recovery Index composition:**
- NDVI recovery: 30%
- dNBR improvement: 20%
- Soil carbon: 15%
- Tree survival: 25%
- Weather suitability: 10%

The contract emits `MilestoneReached` events when the project hits key targets (50% NDVI recovery, Recovery Index > 500).

**Key CRE patterns:** `CronCapability` (6h), `HTTPClient`, `ConsensusAggregationByFields` + `median`, `AggregatorV3Interface`

---

## Privacy Infrastructure

R00t.fund's privacy layer is built on ZK-SNARK proofs with a UTXO commitment model:

### Commitment System

```
commitment = Poseidon(nullifier, secret, amount)
```

| Component | Implementation |
|-----------|---------------|
| Hash function | Poseidon T3 (BN254-friendly) |
| Merkle tree | Incremental, depth 24 (~16M leaves) |
| Root history | 1000-root circular buffer + full historical mapping |
| Nullifier registry | Cross-pool coordination with cooldown periods |
| Scalar field | BN254: 21888242871839275222246405745257275088548364400416034343698204186575808495617 |

### ZK Circuits (Circom)

| Circuit | Public Signals | Purpose |
|---------|:-------------:|---------|
| `sell` | 9 | Sell private tokens for ETH |
| `transfer` | 4 | Private P2P transfer |
| `merge` | 5 | Consolidate commitments |
| `withdraw` | — | Exit private to public |
| `addLiquidity` | — | Private LP deposit |
| `removeLiquidity` | — | Private LP withdrawal |
| `claimLPFees` | — | Claim fees without revealing LP identity |
| `swap` | — | Atomic private swap |
| `pledge` | — | Governance pledge |
| `vote` | — | Private governance vote |

### Chainlink CRE + Privacy Integration

The `insertCommitmentFromCRE()` function on `ZkAMMv3Pair` allows authorized CRE callback contracts to insert commitments directly into the Merkle tree — bridging the compliance layer (W6) with the privacy layer:

```solidity
function insertCommitmentFromCRE(
    uint256 commitment,
    bytes calldata encryptedNote
) external nonReentrant returns (uint256 leafIndex)
```

Authorization flows through `ZkAMMv3Admin.authorizedCRECallback` with a timelock.

---

## Smart Contracts

### Core Protocol

| Contract | Purpose | File |
|----------|---------|------|
| `ZkAMMv3Pair` | Core AMM state — reserves, commitments, Merkle trees | [`contracts/src/ZkAMMv3Pair.sol`](contracts/src/ZkAMMv3Pair.sol) |
| `ZkAMMv3Router` | User-facing operations — buy, sell, swap, LP | [`contracts/src/ZkAMMv3Router.sol`](contracts/src/ZkAMMv3Router.sol) |
| `ZkAMMv3Admin` | Admin, timelocks, emergency multisig, CRE authorization | [`contracts/src/ZkAMMv3Admin.sol`](contracts/src/ZkAMMv3Admin.sol) |
| `R00TShorts` | Short selling with collateral management | [`contracts/src/R00TShorts.sol`](contracts/src/R00TShorts.sol) |
| `RootToken` | ROOT ERC20 token (69M supply) | [`contracts/src/RootToken.sol`](contracts/src/RootToken.sol) |
| `LaunchpadGovernanceV2` | Project governance — propose, vote, execute | [`contracts/src/LaunchpadGovernanceV2.sol`](contracts/src/LaunchpadGovernanceV2.sol) |
| `TokenPool` | Poseidon Merkle tree (depth 24) | [`contracts/src/TokenPool.sol`](contracts/src/TokenPool.sol) |
| `NullifierRegistry` | Cross-pool double-spend prevention | [`contracts/src/NullifierRegistry.sol`](contracts/src/NullifierRegistry.sol) |

### CRE Callback Contracts

| Contract | Workflow | Chainlink Interface |
|----------|:--------:|---------------------|
| `R00tCREReceiver` | Base | DON forwarder validation, pause/unpause |
| `ConfidentialFundingVault` | W1 | Carbon credit attestations + encrypted impact data |
| `RegenProofOfReserve` | W2 | `AggregatorV3Interface` — standard Chainlink data feed |
| `AIAgentOrchestrator` | W3 | Market analysis + governance advisory storage |
| `RegenPredictionMarket` | W4 | Full prediction market with CRE settlement |
| `ProtocolHealthMonitor` | W5 | Health reports + auto circuit breaker |
| `R00tPolicyEngine` | W6 | Compliance oracle (5 levels, 5 transfer types, 32 jurisdictions) |
| `CompliantPrivateVault` | W6 | ACE-pattern vault with compliance-gated commitments |
| `SerraEstrelaNativeForest` | W7 | `AggregatorV3Interface` — Fire Recovery Index feed |

---

## Project Structure

```
R00t.fund/
├── contracts/                          # Solidity (Foundry)
│   ├── src/
│   │   ├── ZkAMMv3Pair.sol            # Core AMM
│   │   ├── ZkAMMv3Router.sol          # User operations
│   │   ├── ZkAMMv3Admin.sol           # Admin + CRE auth
│   │   ├── R00TShorts.sol             # Short selling
│   │   ├── TokenPool.sol              # Poseidon Merkle tree
│   │   ├── NullifierRegistry.sol      # Cross-pool nullifiers
│   │   ├── cre/                       # CRE callback contracts (9 files)
│   │   ├── interfaces/                # Contract interfaces
│   │   └── verifiers/                 # ZK proof verifiers (10 circuits)
│   ├── script/
│   │   └── DeployTenderlyVNet.s.sol   # Full Tenderly VNet deployment (27+ contracts)
│   └── foundry.toml
│
├── circuits/                           # Circom ZK circuits
│   ├── sell.circom
│   ├── transfer.circom
│   ├── merge.circom
│   ├── withdraw.circom
│   ├── addLiquidity.circom
│   ├── removeLiquidity.circom
│   ├── claimLPFees.circom
│   ├── swap.circom
│   ├── pledge.circom
│   ├── vote.circom
│   └── build/                         # Compiled circuits + zkeys
│
├── cre-workflows/                      # Chainlink CRE workflows
│   ├── project.yaml                   # Shared config (incl. Tenderly VNet RPC)
│   ├── .env.tenderly                  # Tenderly VNet deployed addresses
│   ├── secrets.yaml                   # DON vault secrets
│   ├── workflow-1-privacy/            # Carbon credit verification
│   │   └── config.tenderly.json       # Tenderly VNet config
│   ├── workflow-2-defi/               # Proof of Reserve
│   ├── workflow-3-ai/                 # AI regeneration validator
│   ├── workflow-4-prediction/         # Outcome markets
│   ├── workflow-5-risk/               # Health monitor
│   ├── workflow-6-compliance/         # ACE compliant transfers
│   ├── workflow-7-serra-estrela/      # Native forest data feed
│   └── contracts/abi/                 # TypeScript ABI exports
│
├── frontend/                           # React + TypeScript + Tailwind
│   └── src/
│       ├── components/                # 27+ UI components
│       ├── hooks/                     # 17 custom hooks (ZK, privacy, trading)
│       └── abis/                      # Contract ABIs
│
├── trading-agents/                     # Autonomous trading strategies
│   └── src/strategies/                # 6 strategies (momentum, mean-reversion, etc.)
│
├── sdk/                                # Protocol SDK (13 modules)
│   └── src/
│       ├── client.ts                  # Main client
│       ├── prover.ts                  # ZK proof generation
│       ├── crypto.ts                  # Poseidon, commitments
│       └── merkle.ts                  # Merkle tree operations
│
├── indexer/                            # Ponder blockchain indexer
├── mcp-server/                         # Claude MCP server
├── zkamm-mcp/                          # ZK-AMM MCP server
├── r00t-node/                          # P2P node (FROST, Monero bridge)
├── relayer/                            # Transaction relayer
├── arbitrage/                          # Arbitrage bot
└── scripts/                            # 64 deployment/utility scripts
```

---

## CRE Workflow Configuration

All workflows share a common configuration in [`cre-workflows/project.yaml`](cre-workflows/project.yaml).

### DON Vault Secrets

| Secret | Used By | Purpose |
|--------|:-------:|---------|
| `carbon_api_key` | W1 | Verra/Gold Standard API access |
| `aes_encryption_key` | W1 | Attestation encryption |
| `llm_api_key` | W3 | LLM API for regeneration analysis |
| `environmental_data_api_key` | W2, W4 | Environmental monitoring APIs |
| `sanctions_api_key` | W5, W6 | OFAC/sanctions screening |
| `chainalysis_api_key` | W6 | Blockchain analytics |
| `mica_compliance_key` | W6 | EU MiCA compliance API |
| `cmvm_api_key` | W6 | Portuguese CMVM registry |

### Running Workflows

```bash
# Simulate a specific workflow
cd cre-workflows/workflow-7-serra-estrela
cre workflow simulate .

# Simulate all workflows
cd cre-workflows
pnpm simulate:all
```

---

## Tenderly Virtual TestNet

> **We are applying to the Tenderly prize: "Build CRE workflows with Tenderly Virtual TestNets"**

The entire R00t.fund protocol is deployed and fully operational on a [Tenderly Virtual TestNet](https://dashboard.tenderly.co/manifestordao/manifestordao/testnet/596dfbfb-e22d-4186-b982-33682540383d) — a Sepolia fork with real-time state sync. All 27+ contracts are live, all 7 CRE workflows are configured, and simulated CRE callback transactions demonstrate the full verification pipeline.

### Virtual TestNet Details

| Property | Value |
|----------|-------|
| **VNet ID** | `596dfbfb-e22d-4186-b982-33682540383d` |
| **Chain ID** | `73571` (Sepolia fork) |
| **Explorer** | [dashboard.tenderly.co/.../testnet/596dfbfb](https://dashboard.tenderly.co/manifestordao/manifestordao/testnet/596dfbfb-e22d-4186-b982-33682540383d) |
| **Public RPC** | See `.env.tenderly` (set `TENDERLY_VIRTUAL_TESTNET_RPC`) |

### Deployed Contracts on VNet

**Core Protocol:**

| Contract | Address |
|----------|---------|
| ZkAMMv3Pair | `0x33512A1AF1dc6793d174DCbA51CF64928A34FA2D` |
| ZkAMMv3Admin | `0x3d64eeF84c643D3c173483f1890319b45A500d42` |
| ZkAMMv3Router | `0x816C86fB7DF284a0733dc32dBC9610fF2e99E5ab` |
| RootToken | `0x5d5A3b19146C1D09e046D88278e1CF8756d5497f` |
| TokenPool | `0x6B3402a2df9D3FC7cF3C82C8c45AE9e35403a7ea` |
| LPPool | `0xbFf46E280E332A6626937eD714D8059043048fC8` |
| LaunchpadGovernanceV2 | `0xE9B842626a46bF2a3EB1bdf309a323D643A15059` |
| R00TShorts | `0xCf731D00BAA3dc5f41F08A86f95c25c12Ad42a79` |

**CRE Callback Contracts:**

| Contract | Workflow | Address |
|----------|:--------:|---------|
| ConfidentialFundingVault | W1 | `0x761746D0733DD9207826188e1b0957b671D7e891` |
| RegenProofOfReserve | W2 | `0x12528a791983b701253d5A390233DD237f912766` |
| AIAgentOrchestrator | W3 | `0x1a0294310050edDe3b8B47E88574Cbd733F57B32` |
| RegenPredictionMarket | W4 | `0xc19E5D429F9FAA4D240582c05d26ffAf379e4299` |
| ProtocolHealthMonitor | W5 | `0xc2C5fDc44cA2b0D1c1Ea6F9f3b58b266e36D8499` |
| R00tPolicyEngine | W6 | `0x3F753d26aA43F3e13BC8938607e3C7c0d03656F7` |
| CompliantPrivateVault | W6 | `0x7C39a23C6a4Ea34af70C05f8BBb35ee3c16B4023` |
| SerraEstrelaNativeForest | W7 | `0x29f577F99D35300AD923cA62304d2E89C51Ea43b` |

### CRE Workflows on Tenderly

Each of the 7 CRE workflows has a dedicated `config.tenderly.json` pointing to the VNet-deployed contracts:

```bash
cre-workflows/workflow-1-privacy/config.tenderly.json
cre-workflows/workflow-2-defi/config.tenderly.json
cre-workflows/workflow-3-ai/config.tenderly.json
cre-workflows/workflow-4-prediction/config.tenderly.json
cre-workflows/workflow-5-risk/config.tenderly.json
cre-workflows/workflow-6-compliance/config.tenderly.json
cre-workflows/workflow-7-serra-estrela/config.tenderly.json
```

### Why Tenderly Virtual TestNets

Tenderly Virtual TestNets are essential for developing CRE workflows against a realistic environment:

1. **State sync from Sepolia** — The VNet forks Sepolia with real-time state, so CRE workflows interact with realistic chain state (Chainlink feeds, deployed registries, etc.)
2. **Full transaction simulation** — Every CRE callback (`receiveReport`, `authorizeTransfer`, etc.) can be simulated and debugged in the Tenderly explorer before deploying to mainnet
3. **Time manipulation** — `evm_increaseTime` + `evm_mine` allow testing timelock-gated CRE authorization flows without waiting 48 hours
4. **Funded accounts** — `tenderly_setBalance` provides unlimited test ETH for simulating all 7 workflows end-to-end
5. **Transaction traces** — Tenderly's debugger shows full execution traces for CRE callback transactions, making it easy to verify that DON forwarder authentication, commitment insertions, and compliance checks work correctly

### Deployment & Simulation

```bash
# Deploy all contracts to Tenderly VNet
cd contracts
forge script script/DeployTenderlyVNet.s.sol --rpc-url tenderly-vnet --broadcast --slow

# Simulate CRE workflow callbacks
cast send $REGEN_PROOF_OF_RESERVE_ADDRESS "receiveReport(uint256,uint256,uint256,uint256)" \
  50000000000000000000 34500000000000000000000 1000000000000000000 25000000 \
  --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC --private-key $PRIVATE_KEY

# Verify contract state
cast call $PROTOCOL_HEALTH_MONITOR_ADDRESS "reportCount()(uint256)" \
  --rpc-url $TENDERLY_VIRTUAL_TESTNET_RPC
```

**Key files:**
- [`contracts/script/DeployTenderlyVNet.s.sol`](contracts/script/DeployTenderlyVNet.s.sol) — Full deployment script (27+ contracts)
- [`cre-workflows/.env.tenderly`](cre-workflows/.env.tenderly) — All deployed addresses
- [`cre-workflows/project.yaml`](cre-workflows/project.yaml) — VNet RPC configuration

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.24, Foundry, via_ir optimization |
| ZK Proofs | Circom 2, snarkjs, Poseidon T3, Groth16 |
| CRE Workflows | TypeScript, @chainlink/cre-sdk, viem |
| Testing & Simulation | Tenderly Virtual TestNets (Sepolia fork, chain 73571) |
| Frontend | React 18, TypeScript, Tailwind CSS, Vite |
| Indexer | Ponder |
| Trading Agents | TypeScript, reactive patterns |
| Monorepo | Turbo, pnpm workspaces |
| Privacy | UTXO commitments, Poseidon Merkle trees (depth 24) |

---

## Security

- **ZK-SNARK privacy** for all private operations (10 circuits)
- **Nullifier registry** with cross-pool coordination and cooldown periods
- **Timelocked admin operations** (48h in production) for all privileged functions
- **Emergency 2-of-3 multisig** for circuit breakers
- **CRE callback authorization** requires timelock via `ZkAMMv3Admin`
- **Depositor binding** prevents front-running of commitment insertions
- **PolicyEngine compliance** with 5 graduated levels and daily volume limits
- **Formal verification modules** in `.context/knowledgebases/solidity/` (20+ FV patterns)

Full security audit report: [`R00T_Security_Audit_Report.tex`](R00T_Security_Audit_Report.tex)

---

## Development

```bash
# Install dependencies
pnpm install

# Build contracts
cd contracts && forge build

# Run contract tests
cd contracts && forge test

# Compile ZK circuits
./scripts/compile-circuits.sh

# Start frontend
cd frontend && pnpm dev

# Start indexer
cd indexer && pnpm dev
```

---

## Hackathon File Links

Per hackathon requirements, here are the key files for each track:

### Privacy Track ($16,000)
- [`cre-workflows/workflow-1-privacy/main.ts`](cre-workflows/workflow-1-privacy/main.ts) — Confidential carbon credit verification
- [`cre-workflows/workflow-6-compliance/main.ts`](cre-workflows/workflow-6-compliance/main.ts) — ACE compliant private transfers
- [`contracts/src/cre/ConfidentialFundingVault.sol`](contracts/src/cre/ConfidentialFundingVault.sol) — Carbon attestation vault
- [`contracts/src/cre/R00tPolicyEngine.sol`](contracts/src/cre/R00tPolicyEngine.sol) — Compliance oracle
- [`contracts/src/cre/CompliantPrivateVault.sol`](contracts/src/cre/CompliantPrivateVault.sol) — ACE vault

### DeFi & Tokenization Track ($20,000)
- [`cre-workflows/workflow-2-defi/main.ts`](cre-workflows/workflow-2-defi/main.ts) — Regenerative Proof of Reserve
- [`cre-workflows/workflow-7-serra-estrela/main.ts`](cre-workflows/workflow-7-serra-estrela/main.ts) — Custom data feed
- [`contracts/src/cre/RegenProofOfReserve.sol`](contracts/src/cre/RegenProofOfReserve.sol) — AggregatorV3 PoR feed
- [`contracts/src/cre/SerraEstrelaNativeForest.sol`](contracts/src/cre/SerraEstrelaNativeForest.sol) — Restoration data feed

### CRE & AI Track ($17,000)
- [`cre-workflows/workflow-3-ai/main.ts`](cre-workflows/workflow-3-ai/main.ts) — AI land regeneration validator
- [`contracts/src/cre/AIAgentOrchestrator.sol`](contracts/src/cre/AIAgentOrchestrator.sol) — AI strategy storage

### Prediction Markets Track ($16,000)
- [`cre-workflows/workflow-4-prediction/main.ts`](cre-workflows/workflow-4-prediction/main.ts) — Environmental outcome markets
- [`contracts/src/cre/RegenPredictionMarket.sol`](contracts/src/cre/RegenPredictionMarket.sol) — Full prediction market

### Risk & Compliance Track ($16,000)
- [`cre-workflows/workflow-5-risk/main.ts`](cre-workflows/workflow-5-risk/main.ts) — Protocol health monitor
- [`contracts/src/cre/ProtocolHealthMonitor.sol`](contracts/src/cre/ProtocolHealthMonitor.sol) — Health reports + circuit breaker

### Tenderly Prize: Build CRE Workflows with Tenderly Virtual TestNets
- [**Tenderly VNet Explorer**](https://dashboard.tenderly.co/manifestordao/manifestordao/testnet/596dfbfb-e22d-4186-b982-33682540383d) — Live explorer with all deployed contracts and simulated transactions
- [`contracts/script/DeployTenderlyVNet.s.sol`](contracts/script/DeployTenderlyVNet.s.sol) — Full deployment script (27+ contracts in 5 phases)
- [`cre-workflows/.env.tenderly`](cre-workflows/.env.tenderly) — All deployed contract addresses on VNet
- [`cre-workflows/project.yaml`](cre-workflows/project.yaml) — Tenderly VNet RPC configuration
- `cre-workflows/workflow-*/config.tenderly.json` — Per-workflow Tenderly configs (7 files)

---

## License

MIT

---

<p align="center">
  <strong>R00t.fund</strong> — Where privacy meets regeneration.
  <br/>
  Built in Portugal. Verified by Chainlink. Rooted in the earth.
</p>
