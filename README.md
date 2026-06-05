# TRON Energy Bypass Test Suite

Production-grade CLI toolkit to determine whether externally delegated TRON Energy can eliminate TRX fee burn for Hex Trust custodial TRC-20 transactions — completely outside Hex's infrastructure.

## Hypothesis

The TRON protocol consumes Energy from the **sender address** at execution time (including delegated Energy). Hex Trust does not need to "see" delegated Energy in their UI — if Energy is available on-chain, the network should use it and burn only bandwidth (~0.345 TRX).

This suite tests that hypothesis with on-chain forensics and an independent delegation "side-car."

## Quick Start

```bash
cd ~/Projects/tron-energy-bypass-suite
cp .env.example .env
# Edit .env with TARGET_ADDRESSES and TRON_GRID_API_KEY
npm install
```

## Environment Variables

See [`.env.example`](.env.example) for all options. Required for most runs:

| Variable | Required | Description |
|----------|----------|-------------|
| `TARGET_ADDRESSES` | Yes (Module 1) | Comma-separated Hex-associated TRON addresses |
| `TRON_GRID_API_KEY` | Recommended | TronGrid API key for rate limits |
| `SPONSOR_WALLET_PRIVATE_KEY` | Module 3 | Nile testnet sponsor wallet |
| `MONTHLY_TX_VOLUME` | Module 5/6 | For break-even calculations |

## CLI Commands

```bash
# Full suite (address intel + hex stub + delegation dry-run + feasibility)
npm run suite -- all --dry-run

# With Hex transaction evidence
npm run suite -- all --tx <hex_withdrawal_tx_hash> --hex-quote 14

# Individual modules
npm run suite -- address-intelligence
npm run suite -- hex-audit
npm run suite -- delegate --strategy always-on --dry-run --network nile
npm run suite -- delegate --strategy jit --jit-address <T...> --dry-run
npm run suite -- delegate --strategy omnibus --dry-run
npm run suite -- forensics --tx <hash> [--known-delegation]
npm run suite -- fee-audit --tx <hash> --hex-quote 14
npm run suite -- feasibility
```

Global flags: `--dry-run`, `--network mainnet|nile`, `--verbose`, `--output-dir reports`

## Operational Runbook

### Phase 1: Address Intelligence (mainnet, read-only)

```bash
npm run suite -- address-intelligence
```

Analyzes 90-day transaction history for each `TARGET_ADDRESSES` entry:

- Fixed vs rotating vs omnibus address patterns
- Activation status (new addresses cost 2× Energy for first USDT)
- Current Energy, Bandwidth, TRX balance
- JIT delegation feasibility score

Output: `reports/address-intelligence-*.json`

### Phase 2: Nile Delegation PoC

1. Create a Nile testnet wallet and fund with TRX from [Nile faucet](https://nileex.io/join/getJoinPage).
2. Stake TRX for Energy on Nile (manual or via TronWeb `freezeBalanceV2`).
3. Set `SPONSOR_WALLET_PRIVATE_KEY` in `.env`.

```bash
# Dry-run first
npm run suite -- delegate --strategy always-on --dry-run --network nile

# Live delegation
npm run suite -- delegate --strategy always-on --network nile
```

Delegation is **blocked on mainnet** unless `--allow-mainnet-delegation` is explicitly passed.

### Phase 3: Hex Withdrawal Forensics (mainnet)

1. Pre-delegate Energy to the Hex sender address (or confirm existing delegation).
2. Initiate a small test withdrawal (1 USDT) via Hex Trust.
3. Paste the transaction hash:

```bash
npm run suite -- forensics --tx <hash> --known-delegation
npm run suite -- fee-audit --tx <hash> --hex-quote 14
npm run suite -- feasibility
```

### Phase 4: Verdict Interpretation

| Verdict | Meaning | Action |
|---------|---------|--------|
| **BYPASSABLE** | `energy_usage > 0`, fee ≈ 0.345 TRX | Build the side-car |
| **REAL LIMITATION** | `energy_usage = 0`, fee ≈ 13–14 TRX | Escalate to Hex with evidence |
| **OMNIBUS BLOCKER** | Rotating addresses, low JIT feasibility | Negotiate fixed senders or abandon |
| **PARTIAL** | Mixed results | Side-car for fixed addresses only |
| **INCONCLUSIVE** | Insufficient data | More test transactions needed |

Markdown verdict report: `reports/verdict-report-*.md`

## TRON Protocol Notes

- Energy delegation only works to **activated external accounts**, not contracts.
- Stake 2.0 `delegateresource` supports optional 3-day lock (`--lock`).
- Standard USDT TRC-20: ~65,000 Energy (existing wallet), ~130,000 (new).
- Without staked Bandwidth: ~0.345 TRX burned per transaction.
- Energy shortfall burns TRX at 0.00028 TRX/Energy.
- `fee_limit` caps max TRX burn for Energy shortfall — it does **not** disable Energy consumption.

## Edge-Case Tests

| Scenario | Command |
|----------|---------|
| New vs existing recipient | Compare forensics on first vs repeat USDT send |
| Locked delegation | `delegate --lock --network nile` |
| Multiple small delegations | Check `delegation-state.json` + on-chain `getDelegatedResourceV2` |
| Pre-energize unused address | Delegate before any Hex tx, then run forensics |
| Zero bandwidth | Confirm `net_fee ≈ 0.345 TRX` even when Energy covers contract |

## Module Reference

| File | Purpose |
|------|---------|
| `src/address-intelligence.ts` | Address discovery & lifecycle monitoring |
| `src/hex-api-audit.ts` | Hex API capability probe (stub without creds) |
| `src/delegation-service.ts` | Independent side-car delegation engine |
| `src/tx-forensics.ts` | Transaction receipt & raw tx inspection |
| `src/fee-audit.ts` | Hex billing vs on-chain burn comparison |
| `src/feasibility-report.ts` | Risk matrix & cost analysis |
| `src/index.ts` | CLI orchestrator |

## Security

- Never commit `.env` or private keys.
- Use a dedicated sponsor wallet with minimal TRX.
- Run delegation PoC on **Nile** only; mainnet requires explicit override.
- `delegation-state.json` is gitignored.

## Development

```bash
npm run typecheck
npm test
```

## Hex API (when credentials arrive)

Set `HEX_TRUST_API_KEY`, `HEX_ENTERPRISE_ID`, and `HEX_PRIVATE_KEY` to enable Module 2 probing. The audit will check for `fee_preference`, `resource_preference`, `energy_limit`, unsigned tx hex, and sender address exposure.
