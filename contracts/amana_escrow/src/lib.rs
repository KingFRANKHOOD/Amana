#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, Env, String,
    Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NEXT_TRADE_ID: Symbol = symbol_short!("NXTTRD");
const BPS_DIVISOR: i128 = 10_000;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InitializedEvent {
    pub admin: Address,
    pub fee_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeCreatedEvent {
    pub trade_id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeFundedEvent {
    pub trade_id: u64,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeCancelledEvent {
    pub trade_id: u64,
    pub refund_amount: i128,
    pub caller: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryConfirmedEvent {
    pub trade_id: u64,
    pub delivered_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FundsReleasedEvent {
    pub trade_id: u64,
    pub seller_amount: i128,
    pub fee_amount: i128,
}

/// Emitted when a mediator resolves a dispute.
///
/// # Math Example (total = 10_000, seller_payout_bps = 7_000, fee_bps = 100):
///   seller_raw   = 10_000 * 7_000 / 10_000 = 7_000
///   fee          =  7_000 *   100 / 10_000 =    70
///   seller_net   =  7_000 -    70          = 6_930
///   buyer_refund = 10_000 -  7_000         = 3_000
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeResolvedEvent {
    pub trade_id: u64,
    pub seller_payout: i128,
    pub buyer_refund: i128,
    pub mediator: Address,
}

/// Emitted when a party submits evidence during a live dispute.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidenceSubmittedEvent {
    pub trade_id: u64,
    pub submitter: Address,
    pub evidence_hash: Bytes,
}

/// Emitted when a buyer or seller formally initiates a dispute.
/// `reason_hash` is an IPFS CID or human-readable string hash describing the
/// grounds for the dispute, recorded immutably on-chain.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeInitiatedEvent {
    pub trade_id: u64,
    pub initiator: Address,
    pub reason_hash: String,
}

/// Emitted when a mediator address is added to the registry by the admin.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediatorAddedEvent {
    pub mediator: Address,
}

/// Emitted when a mediator address is removed from the registry by the admin.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediatorRemovedEvent {
    pub mediator: Address,
}

// ---------------------------------------------------------------------------
// Types & Storage
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TradeStatus {
    Created,
    Funded,
    Delivered,
    Completed,
    Disputed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Trade {
    pub trade_id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    pub status: TradeStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub funded_at: Option<u64>,
    pub delivered_at: Option<u64>,
    pub buyer_loss_bps: u32,
    pub seller_loss_bps: u32,
}

/// Persistent record of a dispute created by `initiate_dispute()`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeRecord {
    /// Address of the party (buyer or seller) who initiated the dispute.
    pub initiator: Address,
    /// IPFS CID or descriptive hash of the dispute grounds, supplied at initiation.
    pub reason_hash: String,
    /// Ledger timestamp when the dispute was raised.
    pub disputed_at: u64,
}

/// Record of a single piece of evidence submitted during a dispute.
/// Multiple evidence records can be submitted by any party or mediator.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidenceRecord {
    /// Address of the party or mediator who submitted this evidence.
    pub submitter: Address,
    /// IPFS CID or hash pointing to the evidence content.
    pub ipfs_hash: String,
    /// Optional IPFS CID or hash describing the evidence.
    pub description_hash: String,
    /// Ledger timestamp when this evidence was submitted.
    pub submitted_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DataKey {
    Trade(u64),
    Initialized,
    Admin,
    UsdcContract,
    FeeBps,
    Treasury,
    /// Legacy single-mediator slot — used by set_mediator() / require_mediator().
    Mediator,
    /// Per-address registry slot. Stores `true` when an address is an approved mediator.
    /// Used by add_mediator() / remove_mediator() / is_mediator().
    MediatorRegistry(Address),
    CancelRequest(u64),
    /// Stores the most-recent evidence hash submitted by each party (legacy).
    Evidence(u64, Address),
    /// Stores the DisputeRecord created by initiate_dispute() for a given trade.
    DisputeData(u64),
    /// Stores the list of all evidence records submitted for a trade.
    EvidenceList(u64),
}

// ---------------------------------------------------------------------------
// Escrow Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // -----------------------------------------------------------------------
    // Admin / Setup
    // -----------------------------------------------------------------------

    pub fn initialize(env: Env, admin: Address, usdc_contract: Address, treasury: Address, fee_bps: u32) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic!("AlreadyInitialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UsdcContract, &usdc_contract);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.events().publish(("amana", "initialized"), InitializedEvent { admin, fee_bps });
    }

    /// Register a single legacy mediator address. Only the admin may call this.
    /// For multi-mediator support, prefer `add_mediator()`.
    pub fn set_mediator(env: Env, mediator: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Mediator, &mediator);
        // Also register in the per-address registry so is_mediator() reflects this.
        env.storage()
            .persistent()
            .set(&DataKey::MediatorRegistry(mediator.clone()), &true);
    }

    // -----------------------------------------------------------------------
    // Mediator registry
    // -----------------------------------------------------------------------

    /// Add `mediator_address` to the approved mediator registry.
    /// Admin only. Emits `MediatorAdded`.
    pub fn add_mediator(env: Env, mediator_address: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::MediatorRegistry(mediator_address.clone()), &true);
        env.events().publish(
            (symbol_short!("MEDADD"), mediator_address.clone()),
            MediatorAddedEvent { mediator: mediator_address },
        );
    }

    /// Remove `mediator_address` from the approved mediator registry.
    /// Admin only. Emits `MediatorRemoved`.
    pub fn remove_mediator(env: Env, mediator_address: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::MediatorRegistry(mediator_address.clone()));
        env.events().publish(
            (symbol_short!("MEDREM"), mediator_address.clone()),
            MediatorRemovedEvent { mediator: mediator_address },
        );
    }

    /// Returns `true` if `address` is currently in the approved mediator registry.
    /// Read-only; callable by anyone.
    pub fn is_mediator(env: Env, address: Address) -> bool {
        env.storage()
            .persistent()
            .get::<_, bool>(&DataKey::MediatorRegistry(address))
            .unwrap_or(false)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Verifies that the caller is an approved mediator (registry OR legacy slot).
    fn require_mediator(env: &Env) -> Address {
        // Use the legacy single-mediator slot (set_mediator also writes to the
        // MediatorRegistry, so both codepaths share the same auth check).
        let mediator: Address = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Mediator)
            .expect("MediatorNotSet");
        mediator.require_auth();
        mediator
    }

    // -----------------------------------------------------------------------
    // Trade lifecycle
    // -----------------------------------------------------------------------

    pub fn create_trade(env: Env, buyer: Address, seller: Address, amount: i128, buyer_loss_bps: u32, seller_loss_bps: u32) -> u64 {
        assert!(amount > 0, "amount must be greater than zero");
        assert!(buyer_loss_bps + seller_loss_bps == 10_000, "loss ratios must sum to 10000 (100%)");
        let next_id: u64 = env.storage().instance().get(&NEXT_TRADE_ID).unwrap_or(1_u64);
        let ledger_seq = env.ledger().sequence() as u64;
        let trade_id = (ledger_seq << 32) | next_id;
        env.storage().instance().set(&NEXT_TRADE_ID, &(next_id + 1));
        let usdc_address: Address = env.storage().instance().get(&DataKey::UsdcContract).expect("Not initialized");
        let now = env.ledger().timestamp();
        let trade = Trade {
            trade_id,
            buyer: buyer.clone(),
            seller: seller.clone(),
            token: usdc_address,
            amount,
            status: TradeStatus::Created,
            created_at: now,
            updated_at: now,
            funded_at: None,
            delivered_at: None,
            buyer_loss_bps,
            seller_loss_bps,
        };
        env.storage().persistent().set(&DataKey::Trade(trade_id), &trade);
        env.events().publish((symbol_short!("TRDCRT"), trade_id), TradeCreatedEvent {
            trade_id, buyer, seller, amount
        });
        trade_id
    }

    pub fn deposit(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        assert!(matches!(trade.status, TradeStatus::Created), "Trade must be in Created status");
        trade.buyer.require_auth();
        let token_client = token::Client::new(&env, &trade.token);
        token_client.transfer(&trade.buyer, &env.current_contract_address(), &trade.amount);
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Funded;
        trade.funded_at = Some(now);
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
        env.events().publish((symbol_short!("TRDFND"), trade_id), TradeFundedEvent {
            trade_id, amount: trade.amount
        });
    }

    pub fn cancel_trade(env: Env, trade_id: u64, caller: Address) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");

        caller.require_auth();

        if matches!(trade.status, TradeStatus::Created) {
            assert!(caller == trade.buyer || caller == trade.seller || caller == admin, "Unauthorized caller");
            Self::execute_cancellation(&env, &mut trade, 0, caller);
        } else if matches!(trade.status, TradeStatus::Funded) {
            let amount = trade.amount;
            if caller == admin {
                Self::execute_cancellation(&env, &mut trade, amount, admin);
            } else {
                assert!(caller == trade.buyer || caller == trade.seller, "Unauthorized caller");

                let req_key = DataKey::CancelRequest(trade_id);
                let mut requests: (bool, bool) = env.storage().persistent().get(&req_key).unwrap_or((false, false));

                if caller == trade.buyer {
                    requests.0 = true;
                } else if caller == trade.seller {
                    requests.1 = true;
                }

                if requests.0 && requests.1 {
                    Self::execute_cancellation(&env, &mut trade, amount, caller);
                    env.storage().persistent().remove(&req_key);
                } else {
                    env.storage().persistent().set(&req_key, &requests);
                    trade.updated_at = env.ledger().timestamp();
                    env.storage().persistent().set(&key, &trade);
                }
            }
        } else {
            panic!("Cannot cancel trade in current status");
        }
    }

    fn execute_cancellation(env: &Env, trade: &mut Trade, refund_amount: i128, caller: Address) {
        if refund_amount > 0 {
            let token_client = token::Client::new(env, &trade.token);
            token_client.transfer(&env.current_contract_address(), &trade.buyer, &refund_amount);
        }

        trade.status = TradeStatus::Cancelled;
        trade.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&DataKey::Trade(trade.trade_id), trade);

        env.events().publish(
            (symbol_short!("TRDCAN"), trade.trade_id),
            TradeCancelledEvent {
                trade_id: trade.trade_id,
                refund_amount,
                caller,
            },
        );
    }

    pub fn confirm_delivery(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        trade.buyer.require_auth();
        assert!(matches!(trade.status, TradeStatus::Funded), "Trade must be funded");
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Delivered;
        trade.delivered_at = Some(now);
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
        env.events().publish((symbol_short!("DELCNF"), trade_id), DeliveryConfirmedEvent {
            trade_id, delivered_at: now
        });
    }

    pub fn release_funds(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        assert!(matches!(trade.status, TradeStatus::Delivered), "Trade must be delivered");
        trade.buyer.require_auth();
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).expect("Treasury not set");
        let fee_amount = (trade.amount * (fee_bps as i128)) / BPS_DIVISOR;
        let seller_amount = trade.amount - fee_amount;
        let token_client = token::Client::new(&env, &trade.token);
        token_client.transfer(&env.current_contract_address(), &trade.seller, &seller_amount);
        if fee_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);
        }
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Completed;
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
        env.events().publish((symbol_short!("RELSD"), trade_id), FundsReleasedEvent {
            trade_id, seller_amount, fee_amount
        });
    }

    // -----------------------------------------------------------------------
    // Dispute resolution
    // -----------------------------------------------------------------------

    /// Raise a dispute on a funded trade. Either buyer or seller may call this.
    pub fn raise_dispute(env: Env, trade_id: u64, caller: Address) {
        caller.require_auth();
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        assert!(
            matches!(trade.status, TradeStatus::Funded),
            "Trade must be funded to raise dispute"
        );
        assert!(
            caller == trade.buyer || caller == trade.seller,
            "Only buyer or seller can raise a dispute"
        );
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Disputed;
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
    }

    /// Formally initiate a dispute on a funded trade, recording the reason on-chain.
    ///
    /// Either the buyer or the seller may call this while the trade is `Funded`.
    /// Calling this:
    ///   - Transitions the trade to `TradeStatus::Disputed` (freezing the escrow)
    ///   - Persists a `DisputeRecord` under `DataKey::DisputeData(trade_id)`
    ///   - Emits a `DisputeInitiated` event containing the trade ID, initiator,
    ///     and the supplied `reason_hash`
    ///
    /// `reason_hash` should be an IPFS CID or the SHA-256 hex digest of a
    /// dispute brief so the full content lives off-chain but is committed here.
    pub fn initiate_dispute(env: Env, trade_id: u64, initiator: Address, reason_hash: String) {
        initiator.require_auth();

        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");

        assert!(
            matches!(trade.status, TradeStatus::Funded),
            "Trade must be in Funded status to initiate a dispute"
        );
        assert!(
            initiator == trade.buyer || initiator == trade.seller,
            "Only the buyer or seller can initiate a dispute"
        );

        let now = env.ledger().timestamp();

        // Persist the structured dispute record for mediator look-up
        let record = DisputeRecord {
            initiator: initiator.clone(),
            reason_hash: reason_hash.clone(),
            disputed_at: now,
        };
        env.storage()
            .persistent()
            .set(&DataKey::DisputeData(trade_id), &record);

        // Lock the trade in Disputed state
        trade.status = TradeStatus::Disputed;
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);

        // Emit on-chain event
        env.events().publish(
            (symbol_short!("DISINI"), trade_id),
            DisputeInitiatedEvent { trade_id, initiator, reason_hash },
        );
    }

    /// Retrieve the `DisputeRecord` stored by `initiate_dispute()`, if any.
    pub fn get_dispute_record(env: Env, trade_id: u64) -> Option<DisputeRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::DisputeData(trade_id))
    }

    /// Resolve a disputed trade. Only the registered mediator may call this.
    ///
    /// # Payout Math
    ///
    /// Given:
    ///   - `total`            = total escrowed amount
    ///   - `seller_payout_bps` = mediator's ruling in basis points (0–10_000)
    ///   - `fee_bps`          = platform fee in basis points (e.g. 100 = 1%)
    ///
    /// Calculations:
    ///   seller_raw   = total * seller_payout_bps / 10_000
    ///   fee          = seller_raw * fee_bps / 10_000
    ///   seller_net   = seller_raw - fee          (transferred to seller)
    ///   buyer_refund = total - seller_raw         (transferred to buyer)
    ///
    /// Example (total=10_000, seller_payout_bps=7_000, fee_bps=100):
    ///   seller_raw   = 7_000
    ///   fee          =    70
    ///   seller_net   = 6_930  → seller
    ///   buyer_refund = 3_000  → buyer
    ///   treasury     =    70  → treasury
    pub fn resolve_dispute(env: Env, trade_id: u64, seller_payout_bps: u32) {
        // 1. Verify caller is the registered mediator
        let mediator = Self::require_mediator(&env);

        assert!(
            seller_payout_bps <= BPS_DIVISOR as u32,
            "seller_payout_bps must be <= 10_000"
        );

        // 2. Load and validate trade
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        assert!(
            matches!(trade.status, TradeStatus::Disputed),
            "Trade must be in Disputed status"
        );

        // 3. Load fee config
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).expect("Treasury not set");

        // 4. Payout math
        let total = trade.amount;
        let seller_raw = total * (seller_payout_bps as i128) / BPS_DIVISOR;
        let fee = seller_raw * (fee_bps as i128) / BPS_DIVISOR;
        let seller_net = seller_raw - fee;
        let buyer_refund = total - seller_raw;

        // 5. Execute three atomic transfers
        let token_client = token::Client::new(&env, &trade.token);

        if seller_net > 0 {
            token_client.transfer(&env.current_contract_address(), &trade.seller, &seller_net);
        }
        if fee > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &fee);
        }
        if buyer_refund > 0 {
            token_client.transfer(&env.current_contract_address(), &trade.buyer, &buyer_refund);
        }

        // 6. Update trade state
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Completed;
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);

        // 7. Emit event
        env.events().publish(
            (symbol_short!("DISRES"), trade_id),
            DisputeResolvedEvent {
                trade_id,
                seller_payout: seller_net,
                buyer_refund,
                mediator,
            },
        );
    }

    // -----------------------------------------------------------------------
    // Evidence
    // -----------------------------------------------------------------------

    /// Submit evidence for an active dispute. Buyer, seller, or any mediator
    /// may call this any number of times while the trade is Disputed.
    /// All evidence submissions are stored as an append-only list on-chain,
    /// creating an immutable audit trail.
    ///
    /// `ipfs_hash` is typically an IPFS CID pointing to the evidence content.
    /// `description_hash` is an optional IPFS CID or hash describing the evidence.
    pub fn submit_evidence(
        env: Env,
        trade_id: u64,
        caller: Address,
        ipfs_hash: String,
        description_hash: String,
    ) {
        caller.require_auth();

        let key = DataKey::Trade(trade_id);
        let trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");

        assert!(
            matches!(trade.status, TradeStatus::Disputed),
            "Evidence can only be submitted for a Disputed trade"
        );

        // Allow buyer, seller, or any mediator to submit evidence
        let is_party = caller == trade.buyer || caller == trade.seller;
        let is_mediator = Self::is_mediator(env.clone(), caller.clone());
        
        assert!(
            is_party || is_mediator,
            "Only buyer, seller, or mediator can submit evidence"
        );

        // Get existing evidence list or create new one
        let evidence_key = DataKey::EvidenceList(trade_id);
        let mut evidence_list: Vec<EvidenceRecord> = env
            .storage()
            .persistent()
            .get(&evidence_key)
            .unwrap_or(Vec::new(&env));

        // Create new evidence record
        let now = env.ledger().timestamp();
        let record = EvidenceRecord {
            submitter: caller.clone(),
            ipfs_hash: ipfs_hash.clone(),
            description_hash: description_hash.clone(),
            submitted_at: now,
        };

        // Append to list
        evidence_list.push_back(record);

        // Store updated list
        env.storage().persistent().set(&evidence_key, &evidence_list);

        // For backward compatibility with legacy get_evidence API, we'll create
        // a simple Bytes representation. Since Soroban String doesn't easily convert
        // to Bytes, we'll use a placeholder approach or store the string length.
        // In practice, clients should use get_evidence_list() for the new API.
        let legacy_bytes = Bytes::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Evidence(trade_id, caller.clone()), &legacy_bytes);

        env.events().publish(
            (symbol_short!("EVDSUB"), trade_id),
            EvidenceSubmittedEvent {
                trade_id,
                submitter: caller,
                evidence_hash: legacy_bytes,
            },
        );
    }

    /// Return all evidence records submitted for a trade, in chronological order.
    /// Returns an empty vector if no evidence has been submitted yet.
    pub fn get_evidence_list(env: Env, trade_id: u64) -> Vec<EvidenceRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::EvidenceList(trade_id))
            .unwrap_or(Vec::new(&env))
    }

    /// Return the evidence hash most recently submitted by `submitter` (legacy).
    /// Returns `None` if no evidence has been submitted yet.
    pub fn get_evidence(env: Env, trade_id: u64, submitter: Address) -> Option<Bytes> {
        env.storage()
            .persistent()
            .get(&DataKey::Evidence(trade_id, submitter))
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn get_trade(env: Env, trade_id: u64) -> Trade {
        let key = DataKey::Trade(trade_id);
        env.storage().persistent().get(&key).expect("Trade not found")
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{token, Address, Env};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn setup_funded_trade(env: &Env, amount: i128, fee_bps: u32) -> (Address, Address, Address, Address, Address, u64) {
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());

        client.initialize(&admin, &usdc_id, &treasury, &fee_bps);

        let token_client = token::StellarAssetClient::new(env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        (contract_id, usdc_id, buyer, seller, treasury, trade_id)
    }

    fn setup_disputed_trade(env: &Env, amount: i128, fee_bps: u32) -> (Address, Address, Address, Address, Address, u64) {
        let (contract_id, usdc_id, buyer, seller, treasury, trade_id) =
            setup_funded_trade(env, amount, fee_bps);
        let client = EscrowContractClient::new(env, &contract_id);
        client.raise_dispute(&trade_id, &buyer);
        (contract_id, usdc_id, buyer, seller, treasury, trade_id)
    }

    // -----------------------------------------------------------------------
    // Existing tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_deposit_succeeds_and_transitions_to_funded() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);

        env.ledger().with_mut(|li| li.timestamp = 1000);
        client.deposit(&trade_id);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Funded));
        assert_eq!(trade.funded_at, Some(1000));

        let token_readonly = token::Client::new(&env, &usdc_id);
        assert_eq!(token_readonly.balance(&client.address), amount);
        assert_eq!(token_readonly.balance(&buyer), 0);
    }

    #[test]
    #[should_panic]
    fn test_deposit_fails_if_caller_is_not_buyer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let trade_id = client.create_trade(&buyer, &seller, &1000_i128, &5000_u32, &5000_u32);
        client.mock_auths(&[]).deposit(&trade_id);
    }

    #[test]
    #[should_panic(expected = "Trade must be in Created status")]
    fn test_deposit_fails_if_trade_already_funded() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &(amount * 2));

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.deposit(&trade_id);
    }

    #[test]
    fn test_cancel_before_funding_succeeds_for_either_party() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let trade_id_1 = client.create_trade(&buyer, &seller, &1000_i128, &5000_u32, &5000_u32);
        client.cancel_trade(&trade_id_1, &buyer);
        assert!(matches!(client.get_trade(&trade_id_1).status, TradeStatus::Cancelled));

        let trade_id_2 = client.create_trade(&buyer, &seller, &1000_i128, &5000_u32, &5000_u32);
        client.cancel_trade(&trade_id_2, &seller);
        assert!(matches!(client.get_trade(&trade_id_2).status, TradeStatus::Cancelled));
    }

    #[test]
    fn test_cancel_after_funding_requires_both_parties() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        client.cancel_trade(&trade_id, &buyer);
        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Funded));

        client.cancel_trade(&trade_id, &seller);
        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Cancelled));
    }

    #[test]
    fn test_cancel_refunds_buyer_correctly() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 5000_i128;
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        let token_readonly = token::Client::new(&env, &usdc_id);
        assert_eq!(token_readonly.balance(&client.address), amount);

        client.cancel_trade(&trade_id, &buyer);
        client.cancel_trade(&trade_id, &seller);

        assert_eq!(token_readonly.balance(&buyer), amount);
        assert_eq!(token_readonly.balance(&client.address), 0);
    }

    #[test]
    #[should_panic(expected = "Cannot cancel trade in current status")]
    fn test_cancel_fails_after_delivery_confirmed() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.confirm_delivery(&trade_id);

        client.cancel_trade(&trade_id, &buyer);
    }

    #[test]
    fn test_release_funds_sends_correct_amounts() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let fee_bps = 100_u32; // 1%
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &fee_bps);

        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id);

        let token_readonly = token::Client::new(&env, &usdc_id);
        assert_eq!(token_readonly.balance(&seller), 9_900);
        assert_eq!(token_readonly.balance(&treasury), 100);
        assert_eq!(token_readonly.balance(&client.address), 0);
        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Completed));
    }

    // -----------------------------------------------------------------------
    // Loss-sharing ratio tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_create_trade_with_valid_loss_ratios() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        // Test 50/50 split
        let trade_id_1 = client.create_trade(&buyer, &seller, &1000_i128, &5000_u32, &5000_u32);
        let trade_1 = client.get_trade(&trade_id_1);
        assert_eq!(trade_1.buyer_loss_bps, 5000);
        assert_eq!(trade_1.seller_loss_bps, 5000);

        // Test 70/30 split (buyer bears 70% of loss)
        let trade_id_2 = client.create_trade(&buyer, &seller, &2000_i128, &7000_u32, &3000_u32);
        let trade_2 = client.get_trade(&trade_id_2);
        assert_eq!(trade_2.buyer_loss_bps, 7000);
        assert_eq!(trade_2.seller_loss_bps, 3000);

        // Test 100/0 split (buyer bears all loss)
        let trade_id_3 = client.create_trade(&buyer, &seller, &3000_i128, &10000_u32, &0_u32);
        let trade_3 = client.get_trade(&trade_id_3);
        assert_eq!(trade_3.buyer_loss_bps, 10000);
        assert_eq!(trade_3.seller_loss_bps, 0);

        // Test 0/100 split (seller bears all loss)
        let trade_id_4 = client.create_trade(&buyer, &seller, &4000_i128, &0_u32, &10000_u32);
        let trade_4 = client.get_trade(&trade_id_4);
        assert_eq!(trade_4.buyer_loss_bps, 0);
        assert_eq!(trade_4.seller_loss_bps, 10000);
    }

    #[test]
    #[should_panic(expected = "loss ratios must sum to 10000 (100%)")]
    fn test_create_trade_fails_if_ratios_dont_sum_to_100() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        // This should panic: 5000 + 4000 = 9000 ≠ 10000
        client.create_trade(&buyer, &seller, &1000_i128, &5000_u32, &4000_u32);
    }

    // -----------------------------------------------------------------------
    // Dispute resolution tests
    // -----------------------------------------------------------------------

    /// 50/50 split: seller gets 5_000 bps (50%), fee = 1% on seller portion.
    ///
    /// total = 10_000, seller_payout_bps = 5_000, fee_bps = 100
    ///   seller_raw   = 10_000 * 5_000 / 10_000 = 5_000
    ///   fee          =  5_000 *   100 / 10_000 =    50
    ///   seller_net   =  5_000 -    50          = 4_950
    ///   buyer_refund = 10_000 -  5_000         = 5_000
    #[test]
    fn test_resolve_50_50_split_calculates_correctly() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 10_000_i128;
        let fee_bps = 100_u32;
        let (contract_id, usdc_id, buyer, seller, treasury, trade_id) =
            setup_disputed_trade(&env, amount, fee_bps);

        let mediator = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.set_mediator(&mediator);

        client.resolve_dispute(&trade_id, &5_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&seller), 4_950, "seller_net mismatch");
        assert_eq!(token.balance(&treasury), 50, "fee mismatch");
        assert_eq!(token.balance(&buyer), 5_000, "buyer_refund mismatch");
        assert_eq!(token.balance(&client.address), 0, "escrow should be empty");
        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Completed));
    }

    /// Full seller payout: seller gets 10_000 bps (100%), buyer gets nothing.
    ///
    /// total = 10_000, seller_payout_bps = 10_000, fee_bps = 100
    ///   seller_raw   = 10_000
    ///   fee          =    100
    ///   seller_net   =  9_900
    ///   buyer_refund =      0
    #[test]
    fn test_resolve_full_seller_payout() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 10_000_i128;
        let fee_bps = 100_u32;
        let (contract_id, usdc_id, buyer, seller, treasury, trade_id) =
            setup_disputed_trade(&env, amount, fee_bps);

        let mediator = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.set_mediator(&mediator);

        client.resolve_dispute(&trade_id, &10_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&seller), 9_900, "seller_net mismatch");
        assert_eq!(token.balance(&treasury), 100, "fee mismatch");
        assert_eq!(token.balance(&buyer), 0, "buyer should receive nothing");
        assert_eq!(token.balance(&client.address), 0);
    }

    /// Full buyer refund: seller gets 0 bps (0%), buyer gets everything back.
    ///
    /// total = 10_000, seller_payout_bps = 0, fee_bps = 100
    ///   seller_raw   =     0
    ///   fee          =     0
    ///   seller_net   =     0
    ///   buyer_refund = 10_000
    #[test]
    fn test_resolve_full_buyer_refund() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 10_000_i128;
        let fee_bps = 100_u32;
        let (contract_id, usdc_id, buyer, seller, treasury, trade_id) =
            setup_disputed_trade(&env, amount, fee_bps);

        let mediator = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.set_mediator(&mediator);

        client.resolve_dispute(&trade_id, &0_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&buyer), 10_000, "buyer_refund mismatch");
        assert_eq!(token.balance(&seller), 0, "seller should receive nothing");
        assert_eq!(token.balance(&treasury), 0, "no fee on zero seller payout");
        assert_eq!(token.balance(&client.address), 0);
    }

    /// Non-mediator address cannot call resolve_dispute.
    #[test]
    #[should_panic]
    fn test_non_mediator_cannot_resolve() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 10_000_i128;
        let fee_bps = 100_u32;
        let (contract_id, _usdc_id, _buyer, _seller, _treasury, trade_id) =
            setup_disputed_trade(&env, amount, fee_bps);

        // Register a mediator but do NOT grant auth to the imposter
        let mediator = Address::generate(&env);
        let imposter = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.set_mediator(&mediator);

        // Imposter tries to resolve — should panic because imposter != mediator
        // mock_all_auths would approve any address, so we clear auths to simulate
        // the imposter calling without the mediator's key
        client
            .mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &imposter,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "resolve_dispute",
                    args: soroban_sdk::vec![
                        &env,
                        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&trade_id, &env),
                        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&5_000_u32, &env),
                    ],
                    sub_invokes: &[],
                },
            }])
            .resolve_dispute(&trade_id, &5_000_u32);
    }

    // -----------------------------------------------------------------------
    // initiate_dispute() tests
    // -----------------------------------------------------------------------

    /// Buyer initiates a dispute: trade transitions to Disputed and DisputeRecord is stored.
    #[test]
    fn test_dispute_initiated_by_buyer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        env.ledger().with_mut(|l| l.timestamp = 5_000);
        let reason = soroban_sdk::String::from_str(&env, "QmBuyerReasonHash1234");
        client.initiate_dispute(&trade_id, &buyer, &reason);

        // Status must be Disputed
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Disputed));
        assert_eq!(trade.updated_at, 5_000);

        // DisputeRecord must be stored with correct fields
        let record = client.get_dispute_record(&trade_id).expect("DisputeRecord must be present");
        assert_eq!(record.initiator, buyer);
        assert_eq!(record.reason_hash, reason);
        assert_eq!(record.disputed_at, 5_000);
    }

    /// Seller initiates a dispute: same logic should hold symmetrically.
    #[test]
    fn test_dispute_initiated_by_seller() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 8_000_i128;
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        env.ledger().with_mut(|l| l.timestamp = 9_000);
        let reason = soroban_sdk::String::from_str(&env, "QmSellerClaimsNonPayment");
        client.initiate_dispute(&trade_id, &seller, &reason);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Disputed));

        let record = client.get_dispute_record(&trade_id).expect("DisputeRecord must be present");
        assert_eq!(record.initiator, seller);
        assert_eq!(record.reason_hash, reason);
        assert_eq!(record.disputed_at, 9_000);
    }

    /// initiate_dispute panics when the trade is not in Funded status (e.g. still Created).
    #[test]
    #[should_panic(expected = "Trade must be in Funded status to initiate a dispute")]
    fn test_dispute_fails_if_trade_not_funded() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        // create_trade but NO deposit — trade is still Created
        let trade_id = client.create_trade(&buyer, &seller, &5_000_i128, &5000_u32, &5000_u32);
        let reason = soroban_sdk::String::from_str(&env, "QmPrematureDispute");
        client.initiate_dispute(&trade_id, &buyer, &reason);
    }

    /// initiate_dispute panics when the trade is already Disputed (cannot dispute twice).
    #[test]
    #[should_panic(expected = "Trade must be in Funded status to initiate a dispute")]
    fn test_dispute_fails_if_already_disputed() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        let reason = soroban_sdk::String::from_str(&env, "QmFirstDispute");
        client.initiate_dispute(&trade_id, &buyer, &reason); // first: OK

        let reason2 = soroban_sdk::String::from_str(&env, "QmDuplicateDispute");
        client.initiate_dispute(&trade_id, &seller, &reason2); // second: must panic
    }

    // -----------------------------------------------------------------------
    // Mediator registry tests
    // -----------------------------------------------------------------------

    fn setup_base(env: &Env) -> (Address, Address, Address) {
        let admin = Address::generate(env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let treasury = Address::generate(env);
        client.initialize(&admin, &usdc_id, &treasury, &100);
        (contract_id, admin, usdc_id)
    }

    /// Admin can add a mediator; is_mediator returns true afterwards.
    #[test]
    fn test_admin_can_add_mediator() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _usdc) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        let mediator = Address::generate(&env);

        assert!(!client.is_mediator(&mediator), "must be false before adding");
        client.add_mediator(&mediator);
        assert!(client.is_mediator(&mediator), "must be true after adding");
    }

    /// Admin can remove a mediator; is_mediator returns false afterwards.
    #[test]
    fn test_admin_can_remove_mediator() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _usdc) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        let mediator = Address::generate(&env);

        client.add_mediator(&mediator);
        assert!(client.is_mediator(&mediator));

        client.remove_mediator(&mediator);
        assert!(!client.is_mediator(&mediator), "must be false after removal");
    }

    /// is_mediator returns false for an unknown address without panic.
    #[test]
    fn test_is_mediator_returns_false_for_unknown() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _usdc) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        let random = Address::generate(&env);
        assert!(!client.is_mediator(&random));
    }

    /// Non-admin cannot add a mediator.
    #[test]
    #[should_panic]
    fn test_non_admin_cannot_add_mediator() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _usdc) = setup_base(&env);
        let impostor = Address::generate(&env);
        let mediator = Address::generate(&env);

        // Only provide auth for the impostor, not the admin
        EscrowContractClient::new(&env, &contract_id)
            .mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &impostor,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "add_mediator",
                    args: soroban_sdk::vec![
                        &env,
                        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&mediator, &env),
                    ],
                    sub_invokes: &[],
                },
            }])
            .add_mediator(&mediator);
    }

    /// Non-admin cannot remove a mediator.
    #[test]
    #[should_panic]
    fn test_non_admin_cannot_remove_mediator() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _usdc) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        let mediator = Address::generate(&env);
        client.add_mediator(&mediator);

        let impostor = Address::generate(&env);
        client
            .mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &impostor,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "remove_mediator",
                    args: soroban_sdk::vec![
                        &env,
                        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&mediator, &env),
                    ],
                    sub_invokes: &[],
                },
            }])
            .remove_mediator(&mediator);
    }
}

// ---------------------------------------------------------------------------
// Phase 2 — Integration Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod integration_tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{token, Address, Bytes, Env};

    // -----------------------------------------------------------------------
    // Shared setup
    // -----------------------------------------------------------------------

    /// Full environment setup: registers contract, sets up USDC asset, mints
    /// `amount` tokens to buyer, initialises escrow with `fee_bps`, registers
    /// a mediator, and returns all relevant handles.
    struct Setup {
        env: Env,
        contract_id: Address,
        usdc_id: Address,
        admin: Address,
        buyer: Address,
        seller: Address,
        treasury: Address,
        mediator: Address,
    }

    impl Setup {
        fn new(amount: i128, fee_bps: u32) -> Self {
            let env = Env::default();
            env.mock_all_auths();

            let admin = Address::generate(&env);
            let buyer = Address::generate(&env);
            let seller = Address::generate(&env);
            let treasury = Address::generate(&env);
            let mediator = Address::generate(&env);

            let contract_id = env.register(EscrowContract, ());
            let client = EscrowContractClient::new(&env, &contract_id);

            let usdc_id = env.register_stellar_asset_contract(admin.clone());
            let mint_client = token::StellarAssetClient::new(&env, &usdc_id);
            mint_client.mint(&buyer, &amount);

            client.initialize(&admin, &usdc_id, &treasury, &fee_bps);
            client.set_mediator(&mediator);

            Setup { env, contract_id, usdc_id, admin, buyer, seller, treasury, mediator }
        }

        fn client(&self) -> EscrowContractClient<'_> {
            EscrowContractClient::new(&self.env, &self.contract_id)
        }

        fn token(&self) -> token::Client<'_> {
            token::Client::new(&self.env, &self.usdc_id)
        }
    }

    /// Create a trade and immediately deposit funds. Returns the trade_id.
    fn create_and_fund(s: &Setup, amount: i128) -> u64 {
        let client = s.client();
        let trade_id = client.create_trade(&s.buyer, &s.seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        trade_id
    }

    // -----------------------------------------------------------------------
    // Integration test 1: Full lifecycle — 50/50 split
    //
    // Scenario:
    //   Both parties contest; mediator rules 50/50.
    //
    //   total = 10_000, seller_payout_bps = 5_000 (50%), fee_bps = 100 (1%)
    //   seller_raw   = 5_000
    //   fee          =    50   ← 1% only on seller's 50%
    //   seller_net   = 4_950  → seller
    //   buyer_refund = 5_000  → buyer
    //   treasury     =    50  → treasury
    // -----------------------------------------------------------------------
    #[test]
    fn test_integration_full_lifecycle_50_50_split() {
        let amount = 10_000_i128;
        let s = Setup::new(amount, 100);
        let client = s.client();
        let token = s.token();

        // ── Step 1: Create trade ────────────────────────────────────────────
        s.env.ledger().with_mut(|l| l.timestamp = 1_000);
        let trade_id = client.create_trade(&s.buyer, &s.seller, &amount, &5000_u32, &5000_u32);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Created), "Step 1: must be Created");
        assert_eq!(trade.created_at, 1_000);

        // ── Step 2: Fund (deposit) ──────────────────────────────────────────
        s.env.ledger().with_mut(|l| l.timestamp = 2_000);
        client.deposit(&trade_id);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Funded), "Step 2: must be Funded");
        assert_eq!(trade.funded_at, Some(2_000));
        assert_eq!(token.balance(&s.contract_id), amount, "Step 2: escrow must hold funds");
        assert_eq!(token.balance(&s.buyer), 0, "Step 2: buyer balance must be 0");

        // ── Step 3: Raise dispute ───────────────────────────────────────────
        s.env.ledger().with_mut(|l| l.timestamp = 3_000);
        client.raise_dispute(&trade_id, &s.buyer);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Disputed), "Step 3: must be Disputed");
        // Funds still locked in escrow
        assert_eq!(token.balance(&s.contract_id), amount, "Step 3: funds must still be in escrow");

        // ── Step 4: Submit evidence (both parties) ──────────────────────────
        s.env.ledger().with_mut(|l| l.timestamp = 4_000);
        let buyer_ipfs = soroban_sdk::String::from_str(&s.env, "QmBuyerEvidenceHash");
        let buyer_desc = soroban_sdk::String::from_str(&s.env, "Buyer proof of payment");
        let seller_ipfs = soroban_sdk::String::from_str(&s.env, "QmSellerEvidenceHash");
        let seller_desc = soroban_sdk::String::from_str(&s.env, "Seller proof of shipment");

        client.submit_evidence(&trade_id, &s.buyer, &buyer_ipfs, &buyer_desc);
        client.submit_evidence(&trade_id, &s.seller, &seller_ipfs, &seller_desc);

        // Evidence retrievable on-chain via new list API
        let evidence_list = client.get_evidence_list(&trade_id);
        assert_eq!(evidence_list.len(), 2, "Step 4: should have 2 evidence records");
        assert_eq!(evidence_list.get(0).unwrap().submitter, s.buyer);
        assert_eq!(evidence_list.get(0).unwrap().ipfs_hash, buyer_ipfs);
        assert_eq!(evidence_list.get(1).unwrap().submitter, s.seller);
        assert_eq!(evidence_list.get(1).unwrap().ipfs_hash, seller_ipfs);
        
        // Trade still Disputed while mediator reviews
        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Disputed));

        // ── Step 5: Mediator resolves — 50/50 ──────────────────────────────
        s.env.ledger().with_mut(|l| l.timestamp = 5_000);
        client.resolve_dispute(&trade_id, &5_000_u32);

        // ── Step 6: Verify final state ──────────────────────────────────────
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Completed), "Step 6: must be Completed");
        assert_eq!(trade.updated_at, 5_000);

        assert_eq!(token.balance(&s.seller),      4_950, "seller_net mismatch");
        assert_eq!(token.balance(&s.treasury),       50, "fee mismatch");
        assert_eq!(token.balance(&s.buyer),         5_000, "buyer_refund mismatch");
        assert_eq!(token.balance(&s.contract_id),      0, "escrow must be empty");
    }

    // -----------------------------------------------------------------------
    // Integration test 2: Full lifecycle — full seller blame
    //
    //   total = 10_000, seller_payout_bps = 10_000 (100%), fee_bps = 100
    //   seller_net   =  9_900 → seller
    //   fee          =    100 → treasury
    //   buyer_refund =      0 → buyer (nothing)
    // -----------------------------------------------------------------------
    #[test]
    fn test_integration_full_lifecycle_full_seller_payout() {
        let amount = 10_000_i128;
        let s = Setup::new(amount, 100);
        let client = s.client();
        let token = s.token();

        // Create → Fund
        s.env.ledger().with_mut(|l| l.timestamp = 1_000);
        let trade_id = create_and_fund(&s, amount);
        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Funded));

        // Seller raises dispute this time
        s.env.ledger().with_mut(|l| l.timestamp = 2_000);
        client.raise_dispute(&trade_id, &s.seller);
        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Disputed));

        // Seller submits evidence; buyer submits none
        let ipfs_hash = soroban_sdk::String::from_str(&s.env, "QmSellerProofOfDelivery");
        let desc_hash = soroban_sdk::String::from_str(&s.env, "Delivery confirmation");
        client.submit_evidence(&trade_id, &s.seller, &ipfs_hash, &desc_hash);
        
        let evidence_list = client.get_evidence_list(&trade_id);
        assert_eq!(evidence_list.len(), 1);
        assert_eq!(evidence_list.get(0).unwrap().submitter, s.seller);

        // Mediator rules fully for seller
        s.env.ledger().with_mut(|l| l.timestamp = 3_000);
        client.resolve_dispute(&trade_id, &10_000_u32);

        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Completed));
        assert_eq!(token.balance(&s.seller),      9_900);
        assert_eq!(token.balance(&s.treasury),      100);
        assert_eq!(token.balance(&s.buyer),             0);
        assert_eq!(token.balance(&s.contract_id),       0);
    }

    // -----------------------------------------------------------------------
    // Integration test 3: Full lifecycle — full buyer refund
    //
    //   total = 10_000, seller_payout_bps = 0 (0%), fee_bps = 100
    //   seller_net   =      0  (no fee either — nothing to charge)
    //   buyer_refund = 10_000  → buyer gets everything back
    // -----------------------------------------------------------------------
    #[test]
    fn test_integration_full_lifecycle_full_buyer_refund() {
        let amount = 10_000_i128;
        let s = Setup::new(amount, 100);
        let client = s.client();
        let token = s.token();

        let trade_id = create_and_fund(&s, amount);
        client.raise_dispute(&trade_id, &s.buyer);

        let ipfs_hash = soroban_sdk::String::from_str(&s.env, "QmBuyerProofNonDelivery");
        let desc_hash = soroban_sdk::String::from_str(&s.env, "Proof seller never delivered");
        client.submit_evidence(&trade_id, &s.buyer, &ipfs_hash, &desc_hash);

        client.resolve_dispute(&trade_id, &0_u32);

        assert_eq!(token.balance(&s.buyer),        10_000);
        assert_eq!(token.balance(&s.seller),             0);
        assert_eq!(token.balance(&s.treasury),           0);
        assert_eq!(token.balance(&s.contract_id),        0);
    }

    // -----------------------------------------------------------------------
    // Out-of-order guard tests
    // -----------------------------------------------------------------------

    /// Cannot raise a dispute before the trade has been funded.
    #[test]
    #[should_panic(expected = "Trade must be funded to raise dispute")]
    fn test_cannot_raise_dispute_before_funding() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = client.create_trade(&s.buyer, &s.seller, &10_000_i128, &5000_u32, &5000_u32);
        // deposit deliberately skipped — trade is still Created
        client.raise_dispute(&trade_id, &s.buyer);
    }

    /// Cannot raise a dispute after delivery has already been confirmed.
    #[test]
    #[should_panic(expected = "Trade must be funded to raise dispute")]
    fn test_cannot_raise_dispute_after_delivery_confirmed() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        client.confirm_delivery(&trade_id); // Funded → Delivered
        // Now in Delivered status — raise_dispute must panic
        client.raise_dispute(&trade_id, &s.buyer);
    }

    /// Cannot submit evidence unless the trade is in Disputed status.
    #[test]
    #[should_panic(expected = "Evidence can only be submitted for a Disputed trade")]
    fn test_cannot_submit_evidence_before_dispute_raised() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        // Trade is Funded, not Disputed
        let ipfs_hash = soroban_sdk::String::from_str(&s.env, "QmPrematureEvidence");
        let desc_hash = soroban_sdk::String::from_str(&s.env, "Premature attempt");
        client.submit_evidence(&trade_id, &s.buyer, &ipfs_hash, &desc_hash);
    }

    /// Cannot resolve a dispute that was never raised (trade is Funded, not Disputed).
    #[test]
    #[should_panic(expected = "Trade must be in Disputed status")]
    fn test_cannot_resolve_without_raising_dispute_first() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        // raise_dispute deliberately skipped
        client.resolve_dispute(&trade_id, &5_000_u32);
    }

    /// Cannot resolve the same trade twice once it is already Completed.
    #[test]
    #[should_panic(expected = "Trade must be in Disputed status")]
    fn test_cannot_resolve_dispute_twice() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        client.raise_dispute(&trade_id, &s.buyer);
        client.resolve_dispute(&trade_id, &5_000_u32); // first resolution OK
        client.resolve_dispute(&trade_id, &5_000_u32); // second must panic
    }

    /// A stranger (neither buyer nor seller) cannot raise a dispute.
    #[test]
    #[should_panic(expected = "Only buyer or seller can raise a dispute")]
    fn test_stranger_cannot_raise_dispute() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        let stranger = Address::generate(&s.env);
        client.raise_dispute(&trade_id, &stranger);
    }

    /// A stranger cannot submit evidence for an active dispute.
    #[test]
    #[should_panic(expected = "Only buyer, seller, or mediator can submit evidence")]
    fn test_stranger_cannot_submit_evidence() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        client.raise_dispute(&trade_id, &s.buyer);
        let stranger = Address::generate(&s.env);
        let ipfs_hash = soroban_sdk::String::from_str(&s.env, "QmMaliciousAttempt");
        let desc_hash = soroban_sdk::String::from_str(&s.env, "Malicious evidence");
        client.submit_evidence(&trade_id, &stranger, &ipfs_hash, &desc_hash);
    }

    // -----------------------------------------------------------------------
    // Evidence submission tests
    // -----------------------------------------------------------------------

    /// Buyer can submit evidence during an active dispute.
    #[test]
    fn test_buyer_can_submit_evidence_during_dispute() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        
        // Raise dispute
        s.env.ledger().with_mut(|l| l.timestamp = 1_000);
        client.raise_dispute(&trade_id, &s.buyer);
        
        // Buyer submits evidence
        s.env.ledger().with_mut(|l| l.timestamp = 2_000);
        let ipfs_hash = soroban_sdk::String::from_str(&s.env, "QmBuyerEvidence123");
        let desc_hash = soroban_sdk::String::from_str(&s.env, "Payment proof");
        client.submit_evidence(&trade_id, &s.buyer, &ipfs_hash, &desc_hash);
        
        // Verify evidence was stored
        let evidence_list = client.get_evidence_list(&trade_id);
        assert_eq!(evidence_list.len(), 1);
        
        let record = evidence_list.get(0).unwrap();
        assert_eq!(record.submitter, s.buyer);
        assert_eq!(record.ipfs_hash, ipfs_hash);
        assert_eq!(record.description_hash, desc_hash);
        assert_eq!(record.submitted_at, 2_000);
    }

    /// Multiple evidence entries accumulate in chronological order.
    #[test]
    fn test_multiple_evidence_entries_accumulate() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        
        // Raise dispute
        s.env.ledger().with_mut(|l| l.timestamp = 1_000);
        client.raise_dispute(&trade_id, &s.buyer);
        
        // Buyer submits first evidence
        s.env.ledger().with_mut(|l| l.timestamp = 2_000);
        let buyer_ipfs_1 = soroban_sdk::String::from_str(&s.env, "QmBuyerEvidence1");
        let buyer_desc_1 = soroban_sdk::String::from_str(&s.env, "Payment receipt");
        client.submit_evidence(&trade_id, &s.buyer, &buyer_ipfs_1, &buyer_desc_1);
        
        // Seller submits evidence
        s.env.ledger().with_mut(|l| l.timestamp = 3_000);
        let seller_ipfs = soroban_sdk::String::from_str(&s.env, "QmSellerEvidence1");
        let seller_desc = soroban_sdk::String::from_str(&s.env, "Shipping label");
        client.submit_evidence(&trade_id, &s.seller, &seller_ipfs, &seller_desc);
        
        // Buyer submits second evidence
        s.env.ledger().with_mut(|l| l.timestamp = 4_000);
        let buyer_ipfs_2 = soroban_sdk::String::from_str(&s.env, "QmBuyerEvidence2");
        let buyer_desc_2 = soroban_sdk::String::from_str(&s.env, "Communication logs");
        client.submit_evidence(&trade_id, &s.buyer, &buyer_ipfs_2, &buyer_desc_2);
        
        // Mediator submits evidence
        s.env.ledger().with_mut(|l| l.timestamp = 5_000);
        let mediator_ipfs = soroban_sdk::String::from_str(&s.env, "QmMediatorAnalysis");
        let mediator_desc = soroban_sdk::String::from_str(&s.env, "Case analysis");
        client.submit_evidence(&trade_id, &s.mediator, &mediator_ipfs, &mediator_desc);
        
        // Verify all evidence is stored in chronological order
        let evidence_list = client.get_evidence_list(&trade_id);
        assert_eq!(evidence_list.len(), 4, "Should have 4 evidence records");
        
        // Check first entry (buyer)
        let record_0 = evidence_list.get(0).unwrap();
        assert_eq!(record_0.submitter, s.buyer);
        assert_eq!(record_0.ipfs_hash, buyer_ipfs_1);
        assert_eq!(record_0.submitted_at, 2_000);
        
        // Check second entry (seller)
        let record_1 = evidence_list.get(1).unwrap();
        assert_eq!(record_1.submitter, s.seller);
        assert_eq!(record_1.ipfs_hash, seller_ipfs);
        assert_eq!(record_1.submitted_at, 3_000);
        
        // Check third entry (buyer again)
        let record_2 = evidence_list.get(2).unwrap();
        assert_eq!(record_2.submitter, s.buyer);
        assert_eq!(record_2.ipfs_hash, buyer_ipfs_2);
        assert_eq!(record_2.submitted_at, 4_000);
        
        // Check fourth entry (mediator)
        let record_3 = evidence_list.get(3).unwrap();
        assert_eq!(record_3.submitter, s.mediator);
        assert_eq!(record_3.ipfs_hash, mediator_ipfs);
        assert_eq!(record_3.submitted_at, 5_000);
    }

    /// Evidence submission fails if trade is not in Disputed status.
    #[test]
    #[should_panic(expected = "Evidence can only be submitted for a Disputed trade")]
    fn test_evidence_submission_fails_if_not_in_dispute() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        
        // Trade is Funded, not Disputed
        let ipfs_hash = soroban_sdk::String::from_str(&s.env, "QmEarlyEvidence");
        let desc_hash = soroban_sdk::String::from_str(&s.env, "Too early");
        client.submit_evidence(&trade_id, &s.buyer, &ipfs_hash, &desc_hash);
    }
}
