# FinanceView

Status: initial BankMCP reader implemented; payments and additional bank adapters
are not implemented. No live bank, card, funding, or checkout has been verified.

Finance is available from the workspace app launcher and can be pinned or opened
in a separate window. Its IPC reader selects an explicitly chosen, connected MCP
server and calls only `list_accounts` and `get_transactions`. It strips full bank
account numbers and raw provider bodies from its output, preserves unavailable
balances, groups booked balances by currency, and retrieves transaction history
one provider page at a time. Data stays in component memory; it is not persisted
by FinanceView. Agent access uses existing per-agent MCP assignments.

## Broad international coverage

The product goal is the broadest practical coverage, not a claim that a provider
can connect every bank. Build provider adapters behind the normalized account and
transaction DTOs in `packages/protocol/src/finance.ts`. Bank discovery must query
the provider for the country, institution, account type, and required product.
A marketing claim about a region is not a connection eligibility decision.

| Region | Candidate | Implementation |
| --- | --- | --- |
| Europe | BankMCP / Enable Banking | Reader implemented; requires user-hosted server and bank consent |
| North America and supported European countries | Plaid | Not integrated |
| Australia | Basiq or another accredited CDR provider | Not integrated; verify commercial and consent requirements |
| Latin America | Belvo | Not integrated; verify each country's account-data products |
| Southeast Asia | Brankas or direct regional integrations | Not integrated; institution and product coverage must be checked |
| Remaining institutions | User-imported statements | Planned fallback, not live bank access |

Do not turn BankMCP's individual-use Enable Banking setup into a multi-user
commercial service. A platform needs the appropriate provider contract. Do not
collect bank passwords in Polymux. Authenticate at the bank/provider, keep tokens
in the backend's encrypted credential storage, and record consent expiry and
revocation. Agent assignments and bank consent are independent controls.

## Agent payments

Stripe Issuing for agents is the relevant card product. Cloudflare Agents supports
x402 and MPP for participating services; it does not itself issue a general-purpose
payment card. Protocol payments and ordinary card checkout are separate adapters.

Production implementation needs a hosted payment service with provider onboarding,
strong user authentication, and webhook handling. A desktop process can be offline
and must not be the sole real-time authorization decision-maker.

1. Determine issuance eligibility from the user's country, business/consumer use,
   and Stripe-approved card programme. Card acceptance abroad does not mean cards
   can be issued to residents everywhere.
2. Create a provider-backed funding account. Accept top-ups through the approved
   provider flow; only settled, reconciled deposits increase spendable funds.
3. Allocate funds to an agent budget in an atomic ledger. A shared issuing balance
   alone does not isolate funds per card. Use integer minor units and currency
   exponents, never floating-point money arithmetic for authorization decisions.
4. Issue task-scoped cards with provider-side per-authorization and cumulative
   limits. Constrain merchant/category where supported. Default to no automatic
   replenishment. Agents can request purchases, not increase their own limits,
   grant themselves funding, or approve their own exceptions.
5. Validate authenticated agent identity, task, currency, amount, destination,
   expiry, and policy version at authorization. Atomically reserve funds before
   issuing a spend capability. Deny on errors and configure provider fallback
   behavior to decline. Network/force-capture exceptions require explicit risk
   accounting; do not promise an absolute cap using authorization webhooks alone.
6. Verify signed webhooks with replay protection, deduplicate provider event IDs,
   and reconcile holds, captures, partial captures, reversals, refunds, fees, FX,
   and disputes. Use idempotency keys; never retry an uncertain funding operation
   under a new key.
7. Keep PAN/CVC and funding credentials out of model prompts, logs, renderer state,
   and the bank-reading MCP. Use a constrained checkout executor or supported
   tokenized checkout. Freeze must disable the provider card and invalidate local
   capabilities; report failure instead of only changing a local UI toggle.
8. Verify test-mode funding through checkout and reconciliation before any live
   activation. Live onboarding and user bank consent remain external requirements.

## Verification

`npx tsx --test apps/desktop/src/main/finance/bank.test.ts` covers validation,
normalization, exact server selection, bounded pagination, and error redaction.
Repository-wide type checks currently have unrelated failures. No app was launched
for visual testing in this change.

## Sources checked on 2026-09-08

- BankMCP source and setup: https://github.com/noskillish/bankmcp
- BankMCP response contracts: https://github.com/noskillish/bankmcp/blob/main/src/tools.ts
- Stripe agent cards: https://docs.stripe.com/issuing/agents
- Cloudflare payments: https://developers.cloudflare.com/agents/tools/payments/
- Plaid coverage: https://plaid.com/global/
- Brankas coverage: https://www.brankas.com/coverage
- Belvo account products: https://developers.belvo.com/apis/belvoopenapispec/accounts

Provider availability must be checked again when configuring a live integration.
