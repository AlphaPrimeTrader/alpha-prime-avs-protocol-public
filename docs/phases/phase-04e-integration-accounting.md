# Phase 4E Integration Accounting

This document describes the local-only integration between Marketplace, Vault,
Ledger, Token, and Migration. It is an accounting specification, not deployment
evidence.

## Core quantities

Let:

- `S` = AVS Token `totalSupply`;
- `T` = Ledger `treasuryAVS`;
- `E = S - T` = `economicSupply`;
- `A` = Ledger `totalNetAssets`;
- `P = floor(A × 1e18 / E)` = official NAV when `E > 0`.

At genesis (`S = 0`) the quote is 1 USDT per AVS. Treasury operations must keep
`T <= S`, and the protocol may not acquire the final economic share because
that would make `E = 0` and leave NAV undefined.

`MAX_SUPPLY = 20,000,000 AVS` is always checked against `S`. Moving existing
shares into treasury changes `T` and `E`, but not `S`, so it never restores mint
capacity.

## Capital allocation

For every real capital inflow `C` received by the Vault:

- `market = floor(C × 500 / 10,000)`;
- `productive = C - market`.

The Vault is the only allocator. Migration passes 100% of capital to it without
splitting. Marketplace Primary Issuance does the same.

Examples:

| Capital inflow | Market liquidity | Productive capital |
| -------------: | ---------------: | -----------------: |
|       100 USDT |           5 USDT |            95 USDT |
|    12,000 USDT |         600 USDT |        11,400 USDT |

Fresh productive capital remains in the Vault as `pendingTradingCapital` until
it is routed. If Trading is configured when fresh capital is allocated, the
exact new productive allocation is routed to the configured
`AVSTradingSettlement`, which atomically forwards it to its configured
`tradingDestination`.
If Trading is not configured, it remains pending and is routed when Trading is
configured.

Returned productive capital is tracked separately as
`returnedTradingCapital`. It is pulled exactly from the configured Trading
Contract and retained in the Vault. It is never automatically sent back to the
same Trading Contract, and it is never mixed into `pendingTradingCapital`.
Accordingly, the Vault's pending trading-related buckets may contain either
fresh productive capital waiting for its first route, or capital deliberately
returned by Trading and awaiting the final Trading lifecycle policy; the
separate state variables make those two economic states explicit.

## Protocol revenue

Marketplace fees are external user-paid value. The Marketplace sends each fee
through the Vault, and the Vault:

1. records it in the Ledger as Protocol Revenue, increasing `A`;
2. allocates 100% of it to pending Marketplace liquidity;
3. never sends it to productive Trading capital.

Therefore market liquidity may grow above 5%. Five percent is the base capital
allocation, not a target or cap, and there is no automatic rebalance.

For a first 100 USDT Primary purchase at NAV 1:

- 100 AVS are minted;
- 5 USDT is base market liquidity;
- 95 USDT is productive capital;
- buyer fee = `floor(100 × 2 / 10,000) = 0.02 USDT`;
- after fee synchronization, market liquidity is 5.02 USDT;
- `A = 100.02 USDT`, `E = 100 AVS`, NAV = 1.0002 USDT/AVS.

## Secondary fees

For a user-to-user fill with gross value `G`:

- buyer pays `G + floor(G × 2 / 10,000)`;
- seller receives `G - floor(G × 2 / 10,000)`;
- both fees are Protocol Revenue.

No AVS is minted or burned, so `S` is unchanged.

Protocol absorption charges only the seller fee. Protocol inventory resale
charges only the buyer fee. Protocol-owned principal moving between liquidity
and inventory is never itself treated as revenue.

## Treasury acquisition

For AVS quantity `Q` acquired at the pre-fill NAV:

- `G = floor(Q × P / 1e18)`;
- Marketplace liquidity decreases by `G`;
- Marketplace inventory increases by `Q`;
- Ledger records `T' = T + Q`;
- Ledger records `A' = A - G`;
- `E' = E - Q`.

Ignoring integer-floor residue, `A'/E' = A/E`, so converting market USDT into
treasury AVS is NAV-neutral. The seller's separate 2 BPS fee is then real
Protocol Revenue and intentionally raises NAV.

The daily protocol absorption allowance is value-based:

- snapshot eligible value = `floor(eligibleAVS × P / 1e18)`;
- raw daily value = `floor(eligibleValue × 5 / 100)`;
- below 5 USDT: zero eligibility;
- otherwise: `min(raw daily value, 3,000 USDT)`;
- no unused amount carries to the next day.

This allowance does not limit user-to-user selling.

## Treasury resale

For treasury quantity `Q` sold at the pre-fill NAV:

- `G = floor(Q × P / 1e18)`;
- Marketplace inventory decreases by `Q`;
- Marketplace liquidity increases by `G`;
- Ledger records `T' = T - Q`;
- Ledger records `A' = A + G`;
- `E' = E + Q`.

Again, principal conversion is NAV-neutral apart from deterministic floor
residue. The buyer's 2 BPS fee is external Protocol Revenue and intentionally
raises NAV after the treasury release.

Thus liquidity is revolving:

`USDT liquidity -> treasury AVS inventory -> buyer USDT -> liquidity`.

Repeated cycles restore principal and add only genuine user-paid fees.

## Trading PnL

Existing Ledger settlement accounting remains unchanged:

- positive realized PnL allocates 10% to `buybackReserve` and 90% to `A`;
- negative realized PnL reduces `A`;
- both use `E`, not `S`, when deriving NAV.

## Trading lifecycle boundary

The Final Protocol Integration Revision defines two independent flows:

- physical fresh capital:
  `Vault -> TradingSettlement -> tradingDestination`;
- economic reporting:
  `Trading Server -> signed TradingSettlement -> Ledger`.

TradingSettlement is the configured Trading Contract at the Vault boundary.
The destination may be an EOA or receiving contract and has no AVS callback
requirement. Forwarding capital does not itself change NAV or PnL, and a signed
settlement does not itself move USDT.

Returned trading capital remains:

`configured Trading Contract -> Vault -> returnedTradingCapital`

Therefore `returnedTradingCapital` must not be described as automatically
deployable again until that policy is approved. It may contain capital
deliberately returned by Trading and awaiting the final lifecycle policy.
