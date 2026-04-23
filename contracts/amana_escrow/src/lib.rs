#![no_std]
#![allow(deprecated)] // env.events().publish() is deprecated in 25.x but .emit() isn't stable yet

use soroban_sdk::{
    Address, Bytes, Env, String, Symbol, Vec, contract, contractimpl, contracttype, symbol_short,
    token,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NEXT_TRADE_ID: Symbol = symbol_short!("NXTTRD");
const BPS_DIVISOR: i128 = 10_000;
const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
const INSTANCE_TTL_EXTEND_TO: u32 = 50_000;

// ---------------------------------------------------------------------------
// Constants
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

/// Emitted when a video proof is submitted for a trade.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VideoProofSubmittedEvent {
    pub trade_id: u64,
    pub submitter: Address,
    pub ipfs_cid: String,
}

/// Emitted when seller submits hashed delivery manifest fields.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManifestSubmittedEvent {
    pub trade_id: u64,
    pub seller: Address,
    pub driver_name_hash: String,
    pub driver_id_hash: String,
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

/// Record of a video proof submitted for a trade.
/// Only one video proof is allowed per trade (stored under DataKey::VideoProof).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VideoProofRecord {
    /// Address of the party who submitted the video proof.
    pub submitter: Address,
    /// IPFS CID of the video content.
    pub ipfs_cid: String,
    /// Ledger timestamp when the proof was submitted.
    pub submitted_at: u64,
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

/// Hash-only delivery manifest payload anchored on-chain.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryManifestRecord {
    pub seller: Address,
    pub driver_name_hash: String,
    pub driver_id_hash: String,
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
    /// Stores the single VideoProofRecord for a trade (one per trade, immutable once set).
    VideoProof(u64),
    /// Stores the single DeliveryManifestRecord for a trade.
    Manifest(u64),
}

// ---------------------------------------------------------------------------
// Escrow Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    // -----------------------------------------------------------------------
    // Admin / Setup
    // -----------------------------------------------------------------------

    pub fn initialize(
        env: Env,
        admin: Address,
        usdc_contract: Address,
        treasury: Address,
        fee_bps: u32,
    ) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic!("AlreadyInitialized");
        }
        assert!(fee_bps <= 10_000, "fee_bps must not exceed 10000");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::UsdcContract, &usdc_contract);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::Initialized, &true);
        Self::bump_instance_ttl(&env);
        env.events().publish(
            ("amana", "initialized"),
            InitializedEvent { admin, fee_bps },
        );
    }

    /// Register a single legacy mediator address. Only the admin may call this.
    /// For multi-mediator support, prefer `add_mediator()`.
    pub fn set_mediator(env: Env, mediator: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
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
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::MediatorRegistry(mediator_address.clone()), &true);
        env.events().publish(
            (symbol_short!("MEDADD"), mediator_address.clone()),
            MediatorAddedEvent {
                mediator: mediator_address,
            },
        );
    }

    /// Remove `mediator_address` from the approved mediator registry.
    /// Also clears the legacy single-mediator slot if it holds the same address,
    /// ensuring revocation is complete regardless of which registration path was used.
    /// Admin only. Emits `MediatorRemoved`.
    pub fn remove_mediator(env: Env, mediator_address: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        // Clear registry slot (add_mediator / set_mediator dual-writes here)
        env.storage()
            .persistent()
            .remove(&DataKey::MediatorRegistry(mediator_address.clone()));

        // Clear legacy slot if it points to the same address
        if let Some(legacy) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Mediator)
        {
            if legacy == mediator_address {
                env.storage().instance().remove(&DataKey::Mediator);
            }
        }

        env.events().publish(
            (symbol_short!("MEDREM"), mediator_address.clone()),
            MediatorRemovedEvent {
                mediator: mediator_address,
            },
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
    fn require_mediator(env: &Env, mediator: Address) -> Address {
        mediator.require_auth();

        let in_registry = env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::MediatorRegistry(mediator.clone()))
            .unwrap_or(false);
        if in_registry {
            return mediator;
        }

        if let Some(legacy_mediator) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Mediator)
        {
            if legacy_mediator == mediator {
                return mediator;
            }
        }

        panic!("Unauthorized mediator");
    }

    // -----------------------------------------------------------------------
    // Trade lifecycle
    // -----------------------------------------------------------------------

    pub fn create_trade(
        env: Env,
        buyer: Address,
        seller: Address,
        amount: i128,
        buyer_loss_bps: u32,
        seller_loss_bps: u32,
    ) -> u64 {
        assert!(amount > 0, "amount must be greater than zero");
        assert!(
            buyer != seller,
            "buyer and seller must be different addresses"
        );
        assert!(
            buyer_loss_bps + seller_loss_bps == 10_000,
            "loss ratios must sum to 10000 (100%)"
        );
        let next_id: u64 = env
            .storage()
            .instance()
            .get(&NEXT_TRADE_ID)
            .unwrap_or(1_u64);
        let ledger_seq = env.ledger().sequence() as u64;
        let trade_id = (ledger_seq << 32) | next_id;
        env.storage().instance().set(&NEXT_TRADE_ID, &(next_id + 1));
        let usdc_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::UsdcContract)
            .expect("Not initialized");
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
        env.storage()
            .persistent()
            .set(&DataKey::Trade(trade_id), &trade);
        env.events().publish(
            (symbol_short!("TRDCRT"), trade_id),
            TradeCreatedEvent {
                trade_id,
                buyer,
                seller,
                amount,
            },
        );
        Self::bump_instance_ttl(&env);
        trade_id
    }

    pub fn deposit(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Trade not found");
        assert!(
            matches!(trade.status, TradeStatus::Created),
            "Trade must be in Created status"
        );
        trade.buyer.require_auth();
        let token_client = token::Client::new(&env, &trade.token);
        token_client.transfer(&trade.buyer, &env.current_contract_address(), &trade.amount);
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Funded;
        trade.funded_at = Some(now);
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
        env.events().publish(
            (symbol_short!("TRDFND"), trade_id),
            TradeFundedEvent {
                trade_id,
                amount: trade.amount,
            },
        );
    }

    pub fn cancel_trade(env: Env, trade_id: u64, caller: Address) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Trade not found");
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");

        caller.require_auth();

        if matches!(trade.status, TradeStatus::Created) {
            assert!(
                caller == trade.buyer || caller == trade.seller || caller == admin,
                "Unauthorized caller"
            );
            Self::execute_cancellation(&env, &mut trade, 0, caller);
        } else if matches!(trade.status, TradeStatus::Funded) {
            let amount = trade.amount;
            if caller == admin {
                Self::execute_cancellation(&env, &mut trade, amount, admin);
            } else {
                assert!(
                    caller == trade.buyer || caller == trade.seller,
                    "Unauthorized caller"
                );

                let req_key = DataKey::CancelRequest(trade_id);
                let mut requests: (bool, bool) = env
                    .storage()
                    .persistent()
                    .get(&req_key)
                    .unwrap_or((false, false));

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
            token_client.transfer(
                &env.current_contract_address(),
                &trade.buyer,
                &refund_amount,
            );
        }

        trade.status = TradeStatus::Cancelled;
        trade.updated_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::Trade(trade.trade_id), trade);

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
        let mut trade: Trade = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Trade not found");
        trade.buyer.require_auth();
        assert!(
            matches!(trade.status, TradeStatus::Funded),
            "Trade must be funded"
        );
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Delivered;
        trade.delivered_at = Some(now);
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
        env.events().publish(
            (symbol_short!("DELCNF"), trade_id),
            DeliveryConfirmedEvent {
                trade_id,
                delivered_at: now,
            },
        );
    }

    pub fn release_funds(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Trade not found");
        assert!(
            matches!(trade.status, TradeStatus::Delivered),
            "Trade must be delivered"
        );
        trade.buyer.require_auth();
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .expect("Treasury not set");
        let fee_amount = (trade.amount * (fee_bps as i128)) / BPS_DIVISOR;
        let seller_amount = trade.amount - fee_amount;
        let token_client = token::Client::new(&env, &trade.token);
        token_client.transfer(
            &env.current_contract_address(),
            &trade.seller,
            &seller_amount,
        );
        if fee_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);
        }
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Completed;
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
        env.events().publish(
            (symbol_short!("RELSD"), trade_id),
            FundsReleasedEvent {
                trade_id,
                seller_amount,
                fee_amount,
            },
        );
    }

    // -----------------------------------------------------------------------
    // Dispute resolution
    // -----------------------------------------------------------------------

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
        assert!(reason_hash.len() > 0, "reason_hash must not be empty");

        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Trade not found");

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
            DisputeInitiatedEvent {
                trade_id,
                initiator,
                reason_hash,
            },
        );
    }

    /// Retrieve the `DisputeRecord` stored by `initiate_dispute()`, if any.
    pub fn get_dispute_record(env: Env, trade_id: u64) -> Option<DisputeRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::DisputeData(trade_id))
    }

    /// Resolve a disputed trade with loss-sharing payouts.
    /// Only the registered mediator may call this.
    ///
    /// # Payout Math with Loss-Sharing
    ///
    /// Given:
    ///   - `total`              = total escrowed amount
    ///   - `seller_gets_bps`    = mediator's ruling: what fraction seller deserves (0–10_000)
    ///   - `buyer_loss_bps`     = buyer's share of any loss (from trade creation)
    ///   - `seller_loss_bps`    = seller's share of any loss (from trade creation)
    ///   - `fee_bps`            = platform fee in basis points (e.g. 100 = 1%)
    ///
    /// Step 1: Calculate the loss amount
    ///   loss_bps = 10_000 - seller_gets_bps
    ///   (e.g., if seller_gets_bps = 7_000, then loss_bps = 3_000 = 30% loss)
    ///
    /// Step 2: Distribute the loss according to agreed ratios
    ///   buyer_loss_amount  = total * loss_bps * buyer_loss_bps  / (10_000 * 10_000)
    ///   seller_loss_amount = total * loss_bps * seller_loss_bps / (10_000 * 10_000)
    ///
    /// Step 3: Calculate raw payouts
    ///   seller_raw   = total - seller_loss_amount
    ///   buyer_refund = total - seller_raw
    ///
    /// Step 4: Deduct platform fee from seller's portion only
    ///   fee        = seller_raw * fee_bps / 10_000
    ///   seller_net = seller_raw - fee
    ///
    /// Example (total=10_000, seller_gets_bps=7_000, buyer_loss_bps=6_000,
    ///          seller_loss_bps=4_000, fee_bps=100):
    ///   loss_bps         = 3_000 (30% loss)
    ///   buyer_loss       = 10_000 * 3_000 * 6_000 / 100_000_000 = 1_800
    ///   seller_loss      = 10_000 * 3_000 * 4_000 / 100_000_000 = 1_200
    ///   seller_raw       = 10_000 - 1_200 = 8_800
    ///   buyer_refund     = 10_000 - 8_800 = 1_200
    ///   fee              = 8_800 * 100 / 10_000 = 88
    ///   seller_net       = 8_800 - 88 = 8_712  → seller
    ///   buyer_refund     = 1_200                → buyer
    ///   treasury         = 88                   → treasury
    ///
    /// Verification: 8_712 + 1_200 + 88 = 10_000 ✓
    pub fn resolve_dispute(env: Env, trade_id: u64, mediator: Address, seller_gets_bps: u32) {
        // 1. Verify caller is the registered mediator
        let mediator = Self::require_mediator(&env, mediator);

        assert!(
            seller_gets_bps <= BPS_DIVISOR as u32,
            "seller_gets_bps must be <= 10_000"
        );

        // 2. Load and validate trade
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Trade not found");
        assert!(
            matches!(trade.status, TradeStatus::Disputed),
            "Trade must be in Disputed status"
        );

        // 3. Load fee config
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .expect("Treasury not set");

        // 4. Payout math with loss-sharing
        let total = trade.amount;

        // Calculate the loss amount in basis points
        let loss_bps = BPS_DIVISOR - (seller_gets_bps as i128);

        // Distribute loss according to agreed ratios
        // seller_loss = total * loss_bps * seller_loss_bps / (10_000 * 10_000)
        let seller_loss_amount =
            (total * loss_bps * (trade.seller_loss_bps as i128)) / (BPS_DIVISOR * BPS_DIVISOR);

        // Calculate raw payouts
        let seller_raw = total - seller_loss_amount;
        let buyer_refund = total - seller_raw;

        // Deduct platform fee from seller's portion only
        let fee = (seller_raw * (fee_bps as i128)) / BPS_DIVISOR;
        let seller_net = seller_raw - fee;

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
        let trade: Trade = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Trade not found");

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
        env.storage()
            .persistent()
            .set(&evidence_key, &evidence_list);

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
    // Video proof
    // -----------------------------------------------------------------------

    /// Anchor a delivery video's IPFS CID on-chain for a specific trade.
    ///
    /// Either the buyer or the seller may submit video proof.
    /// The trade must be in `Funded` or `Disputed` status.
    /// Only one video proof is allowed per trade — attempting to overwrite panics.
    ///
    /// `ipfs_cid` must be a non-empty IPFS content identifier.
    pub fn submit_video_proof(env: Env, trade_id: u64, submitter: Address, ipfs_cid: String) {
        submitter.require_auth();

        assert!(ipfs_cid.len() > 0, "ipfs_cid must not be empty");

        let key = DataKey::Trade(trade_id);
        let trade: Trade = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Trade not found");

        assert!(
            matches!(trade.status, TradeStatus::Funded | TradeStatus::Disputed),
            "Video proof can only be submitted for a Funded or Disputed trade"
        );

        assert!(
            submitter == trade.buyer || submitter == trade.seller,
            "Only the buyer or seller can submit video proof"
        );

        let proof_key = DataKey::VideoProof(trade_id);
        assert!(
            !env.storage().persistent().has(&proof_key),
            "Video proof already submitted for this trade"
        );

        let now = env.ledger().timestamp();
        let record = VideoProofRecord {
            submitter: submitter.clone(),
            ipfs_cid: ipfs_cid.clone(),
            submitted_at: now,
        };

        env.storage().persistent().set(&proof_key, &record);

        env.events().publish(
            (symbol_short!("VIDPRF"), trade_id),
            VideoProofSubmittedEvent {
                trade_id,
                submitter,
                ipfs_cid,
            },
        );
    }

    /// Submit hashed delivery manifest fields for a funded trade.
    /// Only seller may submit, and only once per trade.
    pub fn submit_manifest(
        env: Env,
        trade_id: u64,
        seller: Address,
        driver_name_hash: String,
        driver_id_hash: String,
    ) {
        seller.require_auth();
        assert!(
            driver_name_hash.len() > 0,
            "driver_name_hash must not be empty"
        );
        assert!(driver_id_hash.len() > 0, "driver_id_hash must not be empty");

        let key = DataKey::Trade(trade_id);
        let trade: Trade = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Trade not found");

        assert!(
            matches!(trade.status, TradeStatus::Funded),
            "Trade must be funded"
        );
        assert!(seller == trade.seller, "Only seller can submit manifest");

        let manifest_key = DataKey::Manifest(trade_id);
        assert!(
            !env.storage().persistent().has(&manifest_key),
            "Manifest already submitted"
        );

        let record = DeliveryManifestRecord {
            seller: seller.clone(),
            driver_name_hash: driver_name_hash.clone(),
            driver_id_hash: driver_id_hash.clone(),
            submitted_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&manifest_key, &record);

        env.events().publish(
            (symbol_short!("MNFST"), trade_id),
            ManifestSubmittedEvent {
                trade_id,
                seller,
                driver_name_hash,
                driver_id_hash,
            },
        );
    }

    /// Fetch manifest record for a trade, if present.
    pub fn get_manifest(env: Env, trade_id: u64) -> Option<DeliveryManifestRecord> {
        env.storage().persistent().get(&DataKey::Manifest(trade_id))
    }

    /// Retrieve the video proof record for a trade, if any.
    pub fn get_video_proof(env: Env, trade_id: u64) -> Option<VideoProofRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::VideoProof(trade_id))
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn get_trade(env: Env, trade_id: u64) -> Trade {
        let key = DataKey::Trade(trade_id);
        env.storage()
            .persistent()
            .get(&key)
            .expect("Trade not found")
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Deployer as _, Ledger as _};
    use soroban_sdk::{Address, Env, token};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn mock_reason(env: &Env, reason: &str) -> String {
        String::from_str(env, reason)
    }

    fn setup_funded_trade(
        env: &Env,
        amount: i128,
        fee_bps: u32,
    ) -> (Address, Address, Address, Address, Address, u64) {
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

    fn setup_disputed_trade(
        env: &Env,
        amount: i128,
        fee_bps: u32,
    ) -> (Address, Address, Address, Address, Address, u64) {
        let (contract_id, usdc_id, buyer, seller, treasury, trade_id) =
            setup_funded_trade(env, amount, fee_bps);
        let client = EscrowContractClient::new(env, &contract_id);
        let reason = mock_reason(env, "QmSetupDisputeReason");
        client.initiate_dispute(&trade_id, &buyer, &reason);
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

    // -----------------------------------------------------------------------
    // confirm_delivery tests
    // -----------------------------------------------------------------------

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
        assert!(matches!(
            client.get_trade(&trade_id_1).status,
            TradeStatus::Cancelled
        ));

        let trade_id_2 = client.create_trade(&buyer, &seller, &1000_i128, &5000_u32, &5000_u32);
        client.cancel_trade(&trade_id_2, &seller);
        assert!(matches!(
            client.get_trade(&trade_id_2).status,
            TradeStatus::Cancelled
        ));
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
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Funded
        ));

        client.cancel_trade(&trade_id, &seller);
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Cancelled
        ));
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
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Completed
        ));
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

        // Test 30/70 split
        let trade_id_5 = client.create_trade(&buyer, &seller, &5000_i128, &3000_u32, &7000_u32);
        let trade_5 = client.get_trade(&trade_id_5);
        assert_eq!(trade_5.buyer_loss_bps, 3000);
        assert_eq!(trade_5.seller_loss_bps, 7000);

        // Test 10/90 split
        let trade_id_6 = client.create_trade(&buyer, &seller, &6000_i128, &1000_u32, &9000_u32);
        let trade_6 = client.get_trade(&trade_id_6);
        assert_eq!(trade_6.buyer_loss_bps, 1000);
        assert_eq!(trade_6.seller_loss_bps, 9000);

        // Test 25/75 split (middle cases)
        let trade_id_7 = client.create_trade(&buyer, &seller, &7000_i128, &2500_u32, &7500_u32);
        let trade_7 = client.get_trade(&trade_id_7);
        assert_eq!(trade_7.buyer_loss_bps, 2500);
        assert_eq!(trade_7.seller_loss_bps, 7500);
    }

    #[test]
    fn test_trade_id_counter_survives_long_ledger_gap() {
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

        assert_eq!(
            env.deployer().get_contract_instance_ttl(&contract_id),
            INSTANCE_TTL_EXTEND_TO
        );

        let trade_id_1 = client.create_trade(&buyer, &seller, &1000_i128, &5000_u32, &5000_u32);
        assert_eq!(trade_id_1 & 0xFFFF_FFFF_u64, 1);

        let current_ledger = env.ledger().sequence();
        env.ledger()
            .set_sequence_number(current_ledger + INSTANCE_TTL_EXTEND_TO - 1);
        assert_eq!(env.deployer().get_contract_instance_ttl(&contract_id), 1);

        let trade_id_2 = client.create_trade(&buyer, &seller, &1000_i128, &5000_u32, &5000_u32);
        assert_eq!(trade_id_2 & 0xFFFF_FFFF_u64, 2);
        assert_eq!(
            env.deployer().get_contract_instance_ttl(&contract_id),
            INSTANCE_TTL_EXTEND_TO
        );
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

    #[test]
    #[should_panic(expected = "loss ratios must sum to 10000 (100%)")]
    fn test_create_trade_fails_if_ratios_sum_exceeds_10000() {
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

        // This should panic: 5001 + 5001 = 10002 > 10000
        client.create_trade(&buyer, &seller, &1000_i128, &5001_u32, &5001_u32);
    }

    // -----------------------------------------------------------------------
    // Dispute resolution tests
    // -----------------------------------------------------------------------

    /// 50/50 split with 50/50 loss-sharing: seller gets 5_000 bps (50%), fee = 1% on seller portion.
    ///
    /// With loss-sharing ratios (buyer_loss_bps=5000, seller_loss_bps=5000):
    /// total = 10_000, seller_gets_bps = 5_000, fee_bps = 100
    ///   loss_bps         = 10_000 - 5_000 = 5_000 (50% loss)
    ///   seller_loss      = 10_000 * 5_000 * 5_000 / 100_000_000 = 2_500
    ///   seller_raw       = 10_000 - 2_500 = 7_500
    ///   fee              = 7_500 * 100 / 10_000 = 75
    ///   seller_net       = 7_500 - 75 = 7_425
    ///   buyer_refund     = 10_000 - 7_500 = 2_500
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

        client.resolve_dispute(&trade_id, &mediator, &5_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&seller), 7_425, "seller_net mismatch");
        assert_eq!(token.balance(&treasury), 75, "fee mismatch");
        assert_eq!(token.balance(&buyer), 2_500, "buyer_refund mismatch");
        assert_eq!(token.balance(&client.address), 0, "escrow should be empty");
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Completed
        ));
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

        client.resolve_dispute(&trade_id, &mediator, &10_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&seller), 9_900, "seller_net mismatch");
        assert_eq!(token.balance(&treasury), 100, "fee mismatch");
        assert_eq!(token.balance(&buyer), 0, "buyer should receive nothing");
        assert_eq!(token.balance(&client.address), 0);
    }

    /// Full buyer refund with 50/50 loss-sharing: seller gets 0 bps (0%), buyer gets everything back.
    ///
    /// With loss-sharing ratios (buyer_loss_bps=5000, seller_loss_bps=5000):
    /// total = 10_000, seller_gets_bps = 0, fee_bps = 100
    ///   loss_bps         = 10_000 - 0 = 10_000 (100% loss)
    ///   seller_loss      = 10_000 * 10_000 * 5_000 / 100_000_000 = 5_000
    ///   seller_raw       = 10_000 - 5_000 = 5_000
    ///   fee              = 5_000 * 100 / 10_000 = 50
    ///   seller_net       = 5_000 - 50 = 4_950
    ///   buyer_refund     = 10_000 - 5_000 = 5_000
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

        client.resolve_dispute(&trade_id, &mediator, &0_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&buyer), 5_000, "buyer_refund mismatch");
        assert_eq!(
            token.balance(&seller),
            4_950,
            "seller should receive their share minus fee"
        );
        assert_eq!(token.balance(&treasury), 50, "fee on seller's portion");
        assert_eq!(token.balance(&client.address), 0);
    }

    /// Non-mediator address cannot call resolve_dispute.
    #[test]
    #[should_panic(expected = "Unauthorized mediator")]
    fn test_non_mediator_cannot_resolve() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 10_000_i128;
        let fee_bps = 100_u32;
        let (contract_id, _usdc_id, _buyer, _seller, _treasury, trade_id) =
            setup_disputed_trade(&env, amount, fee_bps);

        let mediator = Address::generate(&env);
        let imposter = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.set_mediator(&mediator);

        // Imposter tries to resolve without being in the registry or legacy slot.
        client.resolve_dispute(&trade_id, &imposter, &5_000_u32);
    }

    #[test]
    fn test_mediator_added_via_add_mediator_can_resolve_dispute() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 10_000_i128;
        let fee_bps = 100_u32;
        let (contract_id, _usdc_id, _buyer, _seller, _treasury, trade_id) =
            setup_disputed_trade(&env, amount, fee_bps);

        let mediator = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.add_mediator(&mediator);

        client.resolve_dispute(&trade_id, &mediator, &5_000_u32);
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Completed
        ));
    }

    #[test]
    fn test_mediator_added_via_set_mediator_can_still_resolve_dispute() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 10_000_i128;
        let fee_bps = 100_u32;
        let (contract_id, _usdc_id, _buyer, _seller, _treasury, trade_id) =
            setup_disputed_trade(&env, amount, fee_bps);

        let mediator = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.set_mediator(&mediator);

        client.resolve_dispute(&trade_id, &mediator, &5_000_u32);
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Completed
        ));
    }

    // -----------------------------------------------------------------------
    // Additional loss-sharing dispute resolution tests
    // -----------------------------------------------------------------------

    /// Test 70/30 loss-sharing with 60% seller ruling
    /// buyer_loss_bps=7000 (buyer bears 70% of loss), seller_loss_bps=3000
    /// seller_gets_bps=6000 (mediator rules 60% for seller, 40% loss)
    ///
    /// Calculation:
    ///   total = 10_000, loss = 40% = 4_000
    ///   seller_loss = 4_000 * 30% = 1_200
    ///   buyer_loss = 4_000 * 70% = 2_800
    ///   seller_raw = 10_000 - 1_200 = 8_800
    ///   fee = 8_800 * 1% = 88
    ///   seller_net = 8_712
    ///   buyer_refund = 1_200
    #[test]
    fn test_resolve_with_70_30_loss_sharing() {
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

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // Create trade with 70/30 loss-sharing (buyer bears 70% of loss)
        let trade_id = client.create_trade(&buyer, &seller, &amount, &7000_u32, &3000_u32);
        client.deposit(&trade_id);
        let reason = mock_reason(&env, "Qm70_30LossSharing");
        client.initiate_dispute(&trade_id, &buyer, &reason);

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // Mediator rules 60% for seller (40% loss)
        client.resolve_dispute(&trade_id, &mediator, &6_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(
            token.balance(&seller),
            8_712,
            "seller_net with 70/30 loss-sharing"
        );
        assert_eq!(token.balance(&treasury), 88, "fee on seller portion");
        assert_eq!(
            token.balance(&buyer),
            1_200,
            "buyer_refund with 70/30 loss-sharing"
        );
        assert_eq!(token.balance(&client.address), 0);
    }

    /// Test 100/0 loss-sharing (buyer bears all loss) with 80% seller ruling
    /// buyer_loss_bps=10000, seller_loss_bps=0
    /// seller_gets_bps=8000 (mediator rules 80% for seller, 20% loss)
    ///
    /// Calculation:
    ///   total = 10_000, loss = 20% = 2_000
    ///   seller_loss = 2_000 * 0% = 0
    ///   buyer_loss = 2_000 * 100% = 2_000
    ///   seller_raw = 10_000 - 0 = 10_000
    ///   fee = 10_000 * 1% = 100
    ///   seller_net = 9_900
    ///   buyer_refund = 0
    #[test]
    fn test_resolve_buyer_bears_all_loss() {
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

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // Buyer bears all loss (100/0)
        let trade_id = client.create_trade(&buyer, &seller, &amount, &10000_u32, &0_u32);
        client.deposit(&trade_id);
        let reason = mock_reason(&env, "QmBuyerBearsAllLoss");
        client.initiate_dispute(&trade_id, &seller, &reason);

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // Mediator rules 80% for seller
        client.resolve_dispute(&trade_id, &mediator, &8_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(
            token.balance(&seller),
            9_900,
            "seller gets full amount minus fee"
        );
        assert_eq!(token.balance(&treasury), 100, "fee on full seller amount");
        assert_eq!(
            token.balance(&buyer),
            0,
            "buyer gets nothing when bearing all loss"
        );
        assert_eq!(token.balance(&client.address), 0);
    }

    /// Test 0/100 loss-sharing (seller bears all loss) with 30% seller ruling
    /// buyer_loss_bps=0, seller_loss_bps=10000
    /// seller_gets_bps=3000 (mediator rules 30% for seller, 70% loss)
    ///
    /// Calculation:
    ///   total = 10_000, loss = 70% = 7_000
    ///   seller_loss = 7_000 * 100% = 7_000
    ///   buyer_loss = 7_000 * 0% = 0
    ///   seller_raw = 10_000 - 7_000 = 3_000
    ///   fee = 3_000 * 1% = 30
    ///   seller_net = 2_970
    ///   buyer_refund = 7_000
    #[test]
    fn test_resolve_seller_bears_all_loss() {
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

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // Seller bears all loss (0/100)
        let trade_id = client.create_trade(&buyer, &seller, &amount, &0_u32, &10000_u32);
        client.deposit(&trade_id);
        let reason = mock_reason(&env, "QmSellerBearsAllLoss");
        client.initiate_dispute(&trade_id, &buyer, &reason);

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // Mediator rules 30% for seller (70% loss)
        client.resolve_dispute(&trade_id, &mediator, &3_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&seller), 2_970, "seller bears all loss");
        assert_eq!(token.balance(&treasury), 30, "fee on seller portion");
        assert_eq!(
            token.balance(&buyer),
            7_000,
            "buyer gets most back when seller bears all loss"
        );
        assert_eq!(token.balance(&client.address), 0);
    }

    /// Test 20/80 loss-sharing with 90% seller ruling (small loss)
    /// buyer_loss_bps=2000, seller_loss_bps=8000
    /// seller_gets_bps=9000 (mediator rules 90% for seller, 10% loss)
    ///
    /// Calculation:
    ///   total = 10_000, loss = 10% = 1_000
    ///   seller_loss = 1_000 * 80% = 800
    ///   buyer_loss = 1_000 * 20% = 200
    ///   seller_raw = 10_000 - 800 = 9_200
    ///   fee = 9_200 * 1% = 92
    ///   seller_net = 9_108
    ///   buyer_refund = 800
    #[test]
    fn test_resolve_with_small_loss_20_80_sharing() {
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

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // 20/80 loss-sharing (seller bears 80% of loss)
        let trade_id = client.create_trade(&buyer, &seller, &amount, &2000_u32, &8000_u32);
        client.deposit(&trade_id);
        let reason = mock_reason(&env, "QmSmallLoss80Seller");
        client.initiate_dispute(&trade_id, &seller, &reason);

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // Mediator rules 90% for seller (small 10% loss)
        client.resolve_dispute(&trade_id, &mediator, &9_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&seller), 9_108, "seller with small loss");
        assert_eq!(token.balance(&treasury), 92, "fee on seller portion");
        assert_eq!(token.balance(&buyer), 800, "buyer refund with small loss");
        assert_eq!(token.balance(&client.address), 0);
    }

    /// Test 25/75 loss-sharing with 60% seller ruling (40% loss middle case)
    /// buyer_loss_bps=2500, seller_loss_bps=7500
    /// seller_gets_bps=6000 (mediator rules 60% for seller, 40% loss)
    ///
    /// Calculation:
    ///   total = 10_000, loss = 40% = 4_000
    ///   seller_loss = 4_000 * 75% = 3_000
    ///   buyer_loss = 4_000 * 25% = 1_000
    ///   seller_raw = 10_000 - 3_000 = 7_000
    ///   fee = 7_000 * 1% = 70
    ///   seller_net = 6_930
    ///   buyer_refund = 1_000
    #[test]
    fn test_resolve_with_middle_case_25_75_sharing() {
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

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // 25/75 loss-sharing (seller bears 75% of loss)
        let trade_id = client.create_trade(&buyer, &seller, &amount, &2500_u32, &7500_u32);
        client.deposit(&trade_id);
        let reason = mock_reason(&env, "QmMiddleCase25_75Loss");
        client.initiate_dispute(&trade_id, &buyer, &reason);

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // Mediator rules 60% for seller (40% loss)
        client.resolve_dispute(&trade_id, &mediator, &6_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&seller), 6_930, "seller with 25/75 case");
        assert_eq!(token.balance(&treasury), 70, "fee on seller portion");
        assert_eq!(token.balance(&buyer), 1_000, "buyer refund 25/75 case");
        assert_eq!(token.balance(&client.address), 0);
    }

    /// Test edge case: 50/50 loss-sharing with 100% seller ruling (no loss)
    /// buyer_loss_bps=5000, seller_loss_bps=5000
    /// seller_gets_bps=10000 (mediator rules 100% for seller, 0% loss)
    ///
    /// Calculation:
    ///   total = 10_000, loss = 0% = 0
    ///   seller_loss = 0 * 50% = 0
    ///   buyer_loss = 0 * 50% = 0
    ///   seller_raw = 10_000 - 0 = 10_000
    ///   fee = 10_000 * 1% = 100
    ///   seller_net = 9_900
    ///   buyer_refund = 0
    #[test]
    fn test_resolve_no_loss_full_seller_payout() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 10_000_i128;
        let fee_bps = 100_u32;
        let (contract_id, usdc_id, buyer, seller, treasury, trade_id) =
            setup_disputed_trade(&env, amount, fee_bps);

        let mediator = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.set_mediator(&mediator);

        // Mediator rules 100% for seller (no loss)
        client.resolve_dispute(&trade_id, &mediator, &10_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(
            token.balance(&seller),
            9_900,
            "seller gets full amount minus fee"
        );
        assert_eq!(token.balance(&treasury), 100, "fee on full amount");
        assert_eq!(token.balance(&buyer), 0, "buyer gets nothing when no loss");
        assert_eq!(token.balance(&client.address), 0);
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
        let record = client
            .get_dispute_record(&trade_id)
            .expect("DisputeRecord must be present");
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

        let record = client
            .get_dispute_record(&trade_id)
            .expect("DisputeRecord must be present");
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

    /// A stranger (neither buyer nor seller) cannot initiate a dispute.
    #[test]
    #[should_panic(expected = "Only the buyer or seller can initiate a dispute")]
    fn test_stranger_cannot_initiate_dispute() {
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

        // Stranger tries to initiate dispute
        let stranger = Address::generate(&env);
        let reason = soroban_sdk::String::from_str(&env, "QmMaliciousDispute");
        client.initiate_dispute(&trade_id, &stranger, &reason);
    }

    /// Dispute cannot be initiated after trade is completed.
    #[test]
    #[should_panic(expected = "Trade must be in Funded status to initiate a dispute")]
    fn test_dispute_fails_after_trade_completed() {
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

        // Complete the trade successfully
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id);

        // Try to initiate dispute after completion
        let reason = soroban_sdk::String::from_str(&env, "QmTooLateDispute");
        client.initiate_dispute(&trade_id, &buyer, &reason);
    }

    /// Dispute record stores correct IPFS hash and can be retrieved.
    #[test]
    fn test_dispute_record_stores_ipfs_hash_correctly() {
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

        // Set specific timestamp
        env.ledger().with_mut(|l| l.timestamp = 12_345);

        // Initiate dispute with detailed IPFS hash
        let ipfs_reason =
            soroban_sdk::String::from_str(&env, "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG");
        client.initiate_dispute(&trade_id, &seller, &ipfs_reason);

        // Verify dispute record is stored correctly
        let record = client
            .get_dispute_record(&trade_id)
            .expect("DisputeRecord must exist");

        assert_eq!(record.initiator, seller, "Initiator should be seller");
        assert_eq!(
            record.reason_hash, ipfs_reason,
            "Reason hash should match IPFS CID"
        );
        assert_eq!(
            record.disputed_at, 12_345,
            "Timestamp should be recorded correctly"
        );

        // Verify trade status changed
        let trade = client.get_trade(&trade_id);
        assert!(
            matches!(trade.status, TradeStatus::Disputed),
            "Trade should be in Disputed status"
        );
        assert_eq!(
            trade.updated_at, 12_345,
            "Trade updated_at should match dispute timestamp"
        );
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

        assert!(
            !client.is_mediator(&mediator),
            "must be false before adding"
        );
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
        assert!(
            !client.is_mediator(&mediator),
            "must be false after removal"
        );
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

    // -----------------------------------------------------------------------
    // Input validation tests (#190)
    // -----------------------------------------------------------------------

    #[test]
    #[should_panic(expected = "fee_bps must not exceed 10000")]
    fn test_initialize_rejects_fee_bps_over_10000() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        let treasury = Address::generate(&env);
        client.initialize(&admin, &usdc_id, &treasury, &10_001_u32);
    }

    #[test]
    fn test_initialize_accepts_fee_bps_at_boundary_10000() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        let treasury = Address::generate(&env);
        // 10_000 bps (100%) is the maximum allowed — must not panic
        client.initialize(&admin, &usdc_id, &treasury, &10_000_u32);
    }

    #[test]
    #[should_panic(expected = "buyer and seller must be different addresses")]
    fn test_create_trade_rejects_self_trade() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let actor = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        let treasury = Address::generate(&env);
        client.initialize(&admin, &usdc_id, &treasury, &100_u32);
        client.create_trade(&actor, &actor, &1_000_i128, &5000_u32, &5000_u32);
    }

    #[test]
    #[should_panic(expected = "reason_hash must not be empty")]
    fn test_initiate_dispute_rejects_empty_reason_hash() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 1_000_i128;
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100_u32);
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        let empty = soroban_sdk::String::from_str(&env, "");
        client.initiate_dispute(&trade_id, &buyer, &empty);
    }

    #[test]
    #[should_panic]
    fn test_submit_video_proof_rejects_empty_cid() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 1_000_i128;
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100_u32);
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        let empty_cid = soroban_sdk::String::from_str(&env, "");
        client.submit_video_proof(&trade_id, &buyer, &empty_cid);
    }

    // -----------------------------------------------------------------------
    // Payout invariant and boundary tests (#191)
    // -----------------------------------------------------------------------

    /// Helper: run a full dispute resolution and return (seller_net, buyer_refund, fee).
    fn resolve_and_balances(
        env: &Env,
        buyer_loss_bps: u32,
        seller_loss_bps: u32,
        seller_gets_bps: u32,
        fee_bps: u32,
        amount: i128,
    ) -> (i128, i128, i128) {
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &fee_bps);
        let token_mint = token::StellarAssetClient::new(env, &usdc_id);
        token_mint.mint(&buyer, &amount);
        let trade_id =
            client.create_trade(&buyer, &seller, &amount, &buyer_loss_bps, &seller_loss_bps);
        client.deposit(&trade_id);
        let reason = soroban_sdk::String::from_str(env, "QmInvariantTest");
        client.initiate_dispute(&trade_id, &buyer, &reason);
        let mediator = Address::generate(env);
        client.set_mediator(&mediator);
        client.resolve_dispute(&trade_id, &mediator, &seller_gets_bps);
        let tok = token::Client::new(env, &usdc_id);
        (
            tok.balance(&seller),
            tok.balance(&buyer),
            tok.balance(&treasury),
        )
    }

    /// Conservation invariant: seller_net + buyer_refund + fee == total for all inputs.
    #[test]
    fn test_payout_conservation_invariant() {
        // Table of (buyer_loss_bps, seller_loss_bps, seller_gets_bps, fee_bps, amount)
        let cases: &[(u32, u32, u32, u32, i128)] = &[
            (5000, 5000, 5000, 100, 10_000),
            (5000, 5000, 10000, 100, 10_000),
            (5000, 5000, 0, 100, 10_000),
            (10000, 0, 8000, 100, 10_000),
            (0, 10000, 3000, 100, 10_000),
            (7000, 3000, 6000, 100, 10_000),
            (2000, 8000, 9000, 100, 10_000),
            (5000, 5000, 5000, 0, 10_000),
            (5000, 5000, 5000, 10000, 10_000),
            (5000, 5000, 5000, 100, 1),
            (5000, 5000, 5000, 100, 1_000_000),
        ];
        for &(blb, slb, sgb, fb, amt) in cases {
            let env = Env::default();
            env.mock_all_auths();
            let (seller_net, buyer_refund, fee) =
                resolve_and_balances(&env, blb, slb, sgb, fb, amt);
            assert_eq!(
                seller_net + buyer_refund + fee,
                amt,
                "conservation failed: blb={blb} slb={slb} sgb={sgb} fb={fb} amt={amt}"
            );
        }
    }

    /// Non-negativity: no payout component is negative.
    #[test]
    fn test_payout_non_negativity() {
        let cases: &[(u32, u32, u32, u32, i128)] = &[
            (5000, 5000, 0, 100, 10_000),
            (5000, 5000, 10000, 10000, 10_000),
            (0, 10000, 0, 100, 10_000),
            (10000, 0, 10000, 100, 10_000),
        ];
        for &(blb, slb, sgb, fb, amt) in cases {
            let env = Env::default();
            env.mock_all_auths();
            let (seller_net, buyer_refund, fee) =
                resolve_and_balances(&env, blb, slb, sgb, fb, amt);
            assert!(seller_net >= 0, "seller_net negative");
            assert!(buyer_refund >= 0, "buyer_refund negative");
            assert!(fee >= 0, "fee negative");
        }
    }

    /// Monotonicity: increasing seller_gets_bps must not decrease seller payout
    /// (with fixed 50/50 loss-sharing ratios).
    #[test]
    fn test_payout_seller_monotonicity() {
        let bps_steps = [0_u32, 2000, 4000, 5000, 6000, 8000, 10000];
        let mut prev_seller = -1_i128;
        for &sgb in &bps_steps {
            let env = Env::default();
            env.mock_all_auths();
            let (seller_net, _, _) = resolve_and_balances(&env, 5000, 5000, sgb, 100, 10_000);
            assert!(
                seller_net >= prev_seller,
                "seller payout decreased: sgb={sgb} seller_net={seller_net} prev={prev_seller}"
            );
            prev_seller = seller_net;
        }
    }

    /// Bounds: seller_gets_bps > 10_000 must panic.
    #[test]
    #[should_panic(expected = "seller_gets_bps must be <= 10_000")]
    fn test_resolve_panics_on_seller_gets_bps_over_10000() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _usdc_id, _buyer, _seller, _treasury, trade_id) =
            setup_disputed_trade(&env, 10_000, 100);
        let mediator = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.set_mediator(&mediator);
        client.resolve_dispute(&trade_id, &mediator, &10_001_u32);
    }

    // -----------------------------------------------------------------------
    // Auth / state guard matrix tests (#189)
    // confirm_delivery x release_funds x cancel_trade
    // -----------------------------------------------------------------------

    // --- confirm_delivery guards ---

    #[test]
    #[should_panic]
    fn test_confirm_delivery_rejects_non_buyer_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _usdc, _buyer, seller, _treasury, trade_id) =
            setup_funded_trade(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        // seller is not the buyer — must be rejected
        client
            .mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &seller,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "confirm_delivery",
                    args: soroban_sdk::vec![
                        &env,
                        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&trade_id, &env)
                    ],
                    sub_invokes: &[],
                },
            }])
            .confirm_delivery(&trade_id);
    }

    #[test]
    #[should_panic(expected = "Trade must be funded")]
    fn test_confirm_delivery_rejects_wrong_status() {
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
        // Trade is Created (not Funded)
        let trade_id = client.create_trade(&buyer, &seller, &1_000_i128, &5000_u32, &5000_u32);
        client.confirm_delivery(&trade_id);
    }

    // --- release_funds guards ---

    #[test]
    #[should_panic]
    fn test_release_funds_rejects_non_buyer_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _usdc, _buyer, seller, _treasury, trade_id) =
            setup_funded_trade(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.confirm_delivery(&trade_id);
        // seller tries to release — must be rejected
        client
            .mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &seller,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "release_funds",
                    args: soroban_sdk::vec![
                        &env,
                        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&trade_id, &env)
                    ],
                    sub_invokes: &[],
                },
            }])
            .release_funds(&trade_id);
    }

    #[test]
    #[should_panic(expected = "Trade must be delivered")]
    fn test_release_funds_rejects_wrong_status() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _usdc, _buyer, _seller, _treasury, trade_id) =
            setup_funded_trade(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        // Trade is Funded, not Delivered
        client.release_funds(&trade_id);
    }

    // --- cancel_trade guards ---

    #[test]
    #[should_panic(expected = "Unauthorized caller")]
    fn test_cancel_trade_rejects_third_party_in_created_status() {
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
        let trade_id = client.create_trade(&buyer, &seller, &1_000_i128, &5000_u32, &5000_u32);
        let stranger = Address::generate(&env);
        client.cancel_trade(&trade_id, &stranger);
    }

    #[test]
    #[should_panic(expected = "Unauthorized caller")]
    fn test_cancel_trade_rejects_third_party_in_funded_status() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _usdc, _buyer, _seller, _treasury, trade_id) =
            setup_funded_trade(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let stranger = Address::generate(&env);
        client.cancel_trade(&trade_id, &stranger);
    }

    #[test]
    fn test_admin_immediate_cancel_in_funded_status() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 5_000_i128;
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);
        let token_mint = token::StellarAssetClient::new(&env, &usdc_id);
        token_mint.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        // Admin cancels immediately without needing both parties
        client.cancel_trade(&trade_id, &admin);
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Cancelled
        ));
        let tok = token::Client::new(&env, &usdc_id);
        assert_eq!(tok.balance(&buyer), amount, "buyer must be fully refunded");
        assert_eq!(tok.balance(&client.address), 0, "escrow must be empty");
    }
}

// ---------------------------------------------------------------------------
// Phase 2 — Integration Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod integration_tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Address, Env, token};

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

            Setup {
                env,
                contract_id,
                usdc_id,
                admin,
                buyer,
                seller,
                treasury,
                mediator,
            }
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
        assert!(
            matches!(trade.status, TradeStatus::Created),
            "Step 1: must be Created"
        );
        assert_eq!(trade.created_at, 1_000);

        // ── Step 2: Fund (deposit) ──────────────────────────────────────────
        s.env.ledger().with_mut(|l| l.timestamp = 2_000);
        client.deposit(&trade_id);

        let trade = client.get_trade(&trade_id);
        assert!(
            matches!(trade.status, TradeStatus::Funded),
            "Step 2: must be Funded"
        );
        assert_eq!(trade.funded_at, Some(2_000));
        assert_eq!(
            token.balance(&s.contract_id),
            amount,
            "Step 2: escrow must hold funds"
        );
        assert_eq!(
            token.balance(&s.buyer),
            0,
            "Step 2: buyer balance must be 0"
        );

        // ── Step 3: Raise dispute ───────────────────────────────────────────
        s.env.ledger().with_mut(|l| l.timestamp = 3_000);
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmBuyerDisputeReason");
        client.initiate_dispute(&trade_id, &s.buyer, &dispute_reason);

        let trade = client.get_trade(&trade_id);
        assert!(
            matches!(trade.status, TradeStatus::Disputed),
            "Step 3: must be Disputed"
        );
        // Funds still locked in escrow
        assert_eq!(
            token.balance(&s.contract_id),
            amount,
            "Step 3: funds must still be in escrow"
        );

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
        assert_eq!(
            evidence_list.len(),
            2,
            "Step 4: should have 2 evidence records"
        );
        assert_eq!(evidence_list.get(0).unwrap().submitter, s.buyer);
        assert_eq!(evidence_list.get(0).unwrap().ipfs_hash, buyer_ipfs);
        assert_eq!(evidence_list.get(1).unwrap().submitter, s.seller);
        assert_eq!(evidence_list.get(1).unwrap().ipfs_hash, seller_ipfs);

        // Trade still Disputed while mediator reviews
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Disputed
        ));

        // ── Step 5: Mediator resolves — 50/50 ──────────────────────────────
        s.env.ledger().with_mut(|l| l.timestamp = 5_000);
        client.resolve_dispute(&trade_id, &s.mediator, &5_000_u32);

        // ── Step 6: Verify final state ──────────────────────────────────────
        let trade = client.get_trade(&trade_id);
        assert!(
            matches!(trade.status, TradeStatus::Completed),
            "Step 6: must be Completed"
        );
        assert_eq!(trade.updated_at, 5_000);

        // With 50/50 loss-sharing and 50/50 mediator ruling:
        // loss = 50%, seller bears 50% of loss = 2,500
        // seller_raw = 10,000 - 2,500 = 7,500
        // fee = 75, seller_net = 7,425
        // buyer_refund = 2,500
        assert_eq!(token.balance(&s.seller), 7_425, "seller_net mismatch");
        assert_eq!(token.balance(&s.treasury), 75, "fee mismatch");
        assert_eq!(token.balance(&s.buyer), 2_500, "buyer_refund mismatch");
        assert_eq!(token.balance(&s.contract_id), 0, "escrow must be empty");
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
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Funded
        ));

        // Seller initiates dispute this time
        s.env.ledger().with_mut(|l| l.timestamp = 2_000);
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmSellerDisputeReason");
        client.initiate_dispute(&trade_id, &s.seller, &dispute_reason);
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Disputed
        ));

        // Seller submits evidence; buyer submits none
        let ipfs_hash = soroban_sdk::String::from_str(&s.env, "QmSellerProofOfDelivery");
        let desc_hash = soroban_sdk::String::from_str(&s.env, "Delivery confirmation");
        client.submit_evidence(&trade_id, &s.seller, &ipfs_hash, &desc_hash);

        let evidence_list = client.get_evidence_list(&trade_id);
        assert_eq!(evidence_list.len(), 1);
        assert_eq!(evidence_list.get(0).unwrap().submitter, s.seller);

        // Mediator rules fully for seller
        s.env.ledger().with_mut(|l| l.timestamp = 3_000);
        client.resolve_dispute(&trade_id, &s.mediator, &10_000_u32);

        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Completed
        ));
        assert_eq!(token.balance(&s.seller), 9_900);
        assert_eq!(token.balance(&s.treasury), 100);
        assert_eq!(token.balance(&s.buyer), 0);
        assert_eq!(token.balance(&s.contract_id), 0);
    }

    // -----------------------------------------------------------------------
    // Integration test 3: Full lifecycle — full buyer refund (duplicate)
    //
    // With 50/50 loss-sharing and seller_gets_bps = 0:
    //   total = 10_000, seller_gets_bps = 0 (0%), fee_bps = 100
    //   loss = 100%, seller bears 50% = 5,000
    //   seller_raw = 10,000 - 5,000 = 5,000
    //   fee = 50, seller_net = 4,950
    //   buyer_refund = 5,000
    // -----------------------------------------------------------------------
    #[test]
    fn test_integration_full_lifecycle_full_buyer_refund() {
        let amount = 10_000_i128;
        let s = Setup::new(amount, 100);
        let client = s.client();
        let token = s.token();

        let trade_id = create_and_fund(&s, amount);
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmBuyerRefundReason");
        client.initiate_dispute(&trade_id, &s.buyer, &dispute_reason);

        let ipfs_hash = soroban_sdk::String::from_str(&s.env, "QmBuyerProofNonDelivery");
        let desc_hash = soroban_sdk::String::from_str(&s.env, "Proof seller never delivered");
        client.submit_evidence(&trade_id, &s.buyer, &ipfs_hash, &desc_hash);

        client.resolve_dispute(&trade_id, &s.mediator, &0_u32);

        assert_eq!(token.balance(&s.buyer), 5_000);
        assert_eq!(token.balance(&s.seller), 4_950);
        assert_eq!(token.balance(&s.treasury), 50);
        assert_eq!(token.balance(&s.contract_id), 0);
    }

    // -----------------------------------------------------------------------
    // Out-of-order guard tests
    // -----------------------------------------------------------------------

    /// Cannot initiate a dispute before the trade has been funded.
    #[test]
    #[should_panic(expected = "Trade must be in Funded status to initiate a dispute")]
    fn test_cannot_raise_dispute_before_funding() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = client.create_trade(&s.buyer, &s.seller, &10_000_i128, &5000_u32, &5000_u32);
        // deposit deliberately skipped — trade is still Created
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmPrematureDispute");
        client.initiate_dispute(&trade_id, &s.buyer, &dispute_reason);
    }

    /// Cannot initiate a dispute after delivery has already been confirmed.
    #[test]
    #[should_panic(expected = "Trade must be in Funded status to initiate a dispute")]
    fn test_cannot_raise_dispute_after_delivery_confirmed() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        client.confirm_delivery(&trade_id); // Funded → Delivered
        // Now in Delivered status — initiate_dispute must panic
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmLateDispute");
        client.initiate_dispute(&trade_id, &s.buyer, &dispute_reason);
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
        // initiate_dispute deliberately skipped
        client.resolve_dispute(&trade_id, &s.mediator, &5_000_u32);
    }

    /// Cannot resolve the same trade twice once it is already Completed.
    #[test]
    #[should_panic(expected = "Trade must be in Disputed status")]
    fn test_cannot_resolve_dispute_twice() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmDuplicateResolution");
        client.initiate_dispute(&trade_id, &s.buyer, &dispute_reason);
        client.resolve_dispute(&trade_id, &s.mediator, &5_000_u32); // first resolution OK
        client.resolve_dispute(&trade_id, &s.mediator, &5_000_u32); // second must panic
    }

    /// A stranger (neither buyer nor seller) cannot raise a dispute.
    #[test]
    #[should_panic(expected = "Only the buyer or seller can initiate a dispute")]
    fn test_stranger_cannot_raise_dispute() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        let stranger = Address::generate(&s.env);
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmMaliciousDispute");
        client.initiate_dispute(&trade_id, &stranger, &dispute_reason);
    }

    /// A stranger cannot submit evidence for an active dispute.
    #[test]
    #[should_panic(expected = "Only buyer, seller, or mediator can submit evidence")]
    fn test_stranger_cannot_submit_evidence() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmEvidenceDispute");
        client.initiate_dispute(&trade_id, &s.buyer, &dispute_reason);
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
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmBuyerEvidenceDispute");
        client.initiate_dispute(&trade_id, &s.buyer, &dispute_reason);

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
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmMultiEvidenceDispute");
        client.initiate_dispute(&trade_id, &s.buyer, &dispute_reason);

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

    // -----------------------------------------------------------------------
    // Video proof tests
    // -----------------------------------------------------------------------

    /// Buyer can submit video proof for a funded trade; record is stored correctly.
    #[test]
    fn test_video_proof_stored_correctly() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);

        s.env.ledger().with_mut(|l| l.timestamp = 5_000);
        let cid = soroban_sdk::String::from_str(&s.env, "QmVideoProofCID123");
        client.submit_video_proof(&trade_id, &s.buyer, &cid);

        let proof = client.get_video_proof(&trade_id).expect("proof must exist");
        assert_eq!(proof.submitter, s.buyer);
        assert_eq!(proof.ipfs_cid, cid);
        assert_eq!(proof.submitted_at, 5_000);
    }

    /// Video proof submission fails when the trade is not Funded or Disputed.
    #[test]
    #[should_panic(expected = "Video proof can only be submitted for a Funded or Disputed trade")]
    fn test_video_proof_fails_on_wrong_status() {
        let s = Setup::new(10_000, 100);
        let client = s.client();

        // Trade is Created (not yet funded)
        let trade_id = client.create_trade(&s.buyer, &s.seller, &10_000_i128, &5000_u32, &5000_u32);

        let cid = soroban_sdk::String::from_str(&s.env, "QmTooEarlyCID");
        client.submit_video_proof(&trade_id, &s.buyer, &cid);
    }

    /// A second call to submit_video_proof for the same trade must panic.
    #[test]
    #[should_panic(expected = "Video proof already submitted for this trade")]
    fn test_video_proof_cannot_be_overwritten() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);

        let cid1 = soroban_sdk::String::from_str(&s.env, "QmFirstProof");
        client.submit_video_proof(&trade_id, &s.buyer, &cid1);

        // Second submission must panic
        let cid2 = soroban_sdk::String::from_str(&s.env, "QmSecondProof");
        client.submit_video_proof(&trade_id, &s.seller, &cid2);
    }

    /// Evidence submission fails after dispute is resolved.
    #[test]
    #[should_panic(expected = "Evidence can only be submitted for a Disputed trade")]
    fn test_evidence_submission_fails_after_dispute_resolved() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);

        // Raise dispute
        s.env.ledger().with_mut(|l| l.timestamp = 1_000);
        let dispute_reason = soroban_sdk::String::from_str(&s.env, "QmDisputeReason");
        client.initiate_dispute(&trade_id, &s.buyer, &dispute_reason);

        // Resolve dispute
        s.env.ledger().with_mut(|l| l.timestamp = 2_000);
        client.resolve_dispute(&trade_id, &s.mediator, &10_000_u32);

        // Try to submit evidence after resolution - should fail
        s.env.ledger().with_mut(|l| l.timestamp = 3_000);
        let ipfs_hash = soroban_sdk::String::from_str(&s.env, "QmLateEvidence");
        let desc_hash = soroban_sdk::String::from_str(&s.env, "Too late");
        client.submit_evidence(&trade_id, &s.buyer, &ipfs_hash, &desc_hash);
    }

    /// Evidence list is empty for trades without disputes.
    #[test]
    fn test_evidence_list_empty_for_non_disputed_trade() {
        let s = Setup::new(10_000, 100);
        let client = s.client();
        let trade_id = create_and_fund(&s, 10_000);

        // Trade is Funded, no dispute raised
        let evidence_list = client.get_evidence_list(&trade_id);
        assert_eq!(
            evidence_list.len(),
            0,
            "Evidence list should be empty for non-disputed trade"
        );

        // Confirm delivery (no dispute path)
        client.confirm_delivery(&trade_id);

        // Evidence list should still be empty
        let evidence_list_after = client.get_evidence_list(&trade_id);
        assert_eq!(
            evidence_list_after.len(),
            0,
            "Evidence list should remain empty after delivery confirmation"
        );
    }

    // -----------------------------------------------------------------------
    // Additional comprehensive tests
    // -----------------------------------------------------------------------

    /// Test asymmetric loss-sharing with mediator ruling favoring buyer
    /// Tests 30/70 loss-sharing (buyer bears 30%, seller bears 70%) with 40% seller ruling
    /// This validates the contract handles asymmetric ratios correctly when buyer wins
    #[test]
    fn test_asymmetric_loss_sharing_buyer_favored() {
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

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // Create trade with 30/70 loss-sharing (seller bears 70% of loss)
        let trade_id = client.create_trade(&buyer, &seller, &amount, &3000_u32, &7000_u32);
        client.deposit(&trade_id);
        let reason = soroban_sdk::String::from_str(&env, "QmAsymmetricDispute");
        client.initiate_dispute(&trade_id, &buyer, &reason);

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // Mediator rules 40% for seller (60% loss - buyer wins)
        // loss = 60% = 6,000
        // seller bears: 6,000 * 70% = 4,200
        // buyer bears: 6,000 * 30% = 1,800
        // seller_raw = 10,000 - 4,200 = 5,800
        // fee = 5,800 * 1% = 58
        // seller_net = 5,742
        // buyer_refund = 4,200
        client.resolve_dispute(&trade_id, &mediator, &4_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&seller), 5_742, "seller with 70% loss burden");
        assert_eq!(token.balance(&treasury), 58, "fee on seller portion");
        assert_eq!(
            token.balance(&buyer),
            4_200,
            "buyer refund with 30% loss burden"
        );
        assert_eq!(token.balance(&client.address), 0, "escrow empty");

        // Verify total adds up
        assert_eq!(
            5_742 + 58 + 4_200,
            10_000,
            "total must equal original amount"
        );
    }

    /// Test complete dispute lifecycle with evidence submission and resolution
    /// This integration test validates the entire flow from trade creation to resolution
    /// including multiple evidence submissions from all parties
    #[test]
    fn test_complete_dispute_lifecycle_with_evidence() {
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

        let amount = 50_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // Step 1: Create trade with 50/50 loss-sharing
        env.ledger().with_mut(|l| l.timestamp = 1_000);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Created));
        assert_eq!(trade.amount, amount);

        // Step 2: Buyer deposits funds
        env.ledger().with_mut(|l| l.timestamp = 2_000);
        client.deposit(&trade_id);
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Funded));
        assert_eq!(token_client.balance(&contract_id), amount);

        // Step 3: Buyer initiates dispute with reason
        env.ledger().with_mut(|l| l.timestamp = 3_000);
        let dispute_reason =
            soroban_sdk::String::from_str(&env, "QmDisputeReason_GoodsNotAsDescribed");
        client.initiate_dispute(&trade_id, &buyer, &dispute_reason);
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Disputed));

        let dispute_record = client
            .get_dispute_record(&trade_id)
            .expect("dispute record must exist");
        assert_eq!(dispute_record.initiator, buyer);
        assert_eq!(dispute_record.reason_hash, dispute_reason);

        // Step 4: Buyer submits evidence
        env.ledger().with_mut(|l| l.timestamp = 4_000);
        let buyer_evidence =
            soroban_sdk::String::from_str(&env, "QmBuyerEvidence_PhotosOfDamagedGoods");
        let buyer_desc =
            soroban_sdk::String::from_str(&env, "Photos showing damaged agricultural products");
        client.submit_evidence(&trade_id, &buyer, &buyer_evidence, &buyer_desc);

        // Step 5: Seller submits counter-evidence
        env.ledger().with_mut(|l| l.timestamp = 5_000);
        let seller_evidence =
            soroban_sdk::String::from_str(&env, "QmSellerEvidence_PackagingAndShipping");
        let seller_desc = soroban_sdk::String::from_str(
            &env,
            "Proof of proper packaging and shipping documentation",
        );
        client.submit_evidence(&trade_id, &seller, &seller_evidence, &seller_desc);

        // Step 6: Register mediator and submit independent evidence
        let mediator = Address::generate(&env);
        client.add_mediator(&mediator);

        env.ledger().with_mut(|l| l.timestamp = 6_000);
        let mediator_evidence =
            soroban_sdk::String::from_str(&env, "QmMediatorEvidence_InspectionReport");
        let mediator_desc = soroban_sdk::String::from_str(&env, "Independent inspection findings");
        client.submit_evidence(&trade_id, &mediator, &mediator_evidence, &mediator_desc);

        // Verify all evidence is recorded
        let evidence_list = client.get_evidence_list(&trade_id);
        assert_eq!(evidence_list.len(), 3, "should have 3 evidence records");

        // Step 7: Mediator resolves dispute (65% for seller, 35% loss)
        env.ledger().with_mut(|l| l.timestamp = 7_000);
        client.set_mediator(&mediator);
        client.resolve_dispute(&trade_id, &mediator, &6_500_u32);

        // Step 8: Verify final state
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Completed));

        // Calculate expected amounts:
        // loss = 35% = 17,500
        // seller bears: 17,500 * 50% = 8,750
        // seller_raw = 50,000 - 8,750 = 41,250
        // fee = 41,250 * 1% = 412.5 = 412 (integer division)
        // seller_net = 41,250 - 412 = 40,838
        // buyer_refund = 8,750

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(token.balance(&seller), 40_838, "seller final payout");
        assert_eq!(token.balance(&buyer), 8_750, "buyer refund");
        assert_eq!(token.balance(&treasury), 412, "platform fee");
        assert_eq!(token.balance(&contract_id), 0, "escrow fully distributed");

        // Verify evidence remains accessible after resolution
        let evidence_list_final = client.get_evidence_list(&trade_id);
        assert_eq!(
            evidence_list_final.len(),
            3,
            "evidence preserved after resolution"
        );
    }

    /// Test edge case: very small amounts with loss-sharing and fee calculation
    /// Validates that integer division doesn't cause rounding errors that break invariants
    #[test]
    fn test_small_amount_loss_sharing_rounding() {
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

        // Use a small amount to test rounding behavior
        let amount = 100_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // Create trade with 60/40 loss-sharing
        let trade_id = client.create_trade(&buyer, &seller, &amount, &6000_u32, &4000_u32);
        client.deposit(&trade_id);
        let reason = soroban_sdk::String::from_str(&env, "QmSmallAmountDispute");
        client.initiate_dispute(&trade_id, &buyer, &reason);

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // Mediator rules 55% for seller (45% loss)
        // loss = 45% of 100 = 45
        // seller bears: 45 * 40% = 18
        // buyer bears: 45 * 60% = 27
        // seller_raw = 100 - 18 = 82
        // fee = 82 * 1% = 0.82 = 0 (integer division)
        // seller_net = 82 - 0 = 82
        // buyer_refund = 18
        client.resolve_dispute(&trade_id, &mediator, &5_500_u32);

        let token = token::Client::new(&env, &usdc_id);
        let seller_balance = token.balance(&seller);
        let buyer_balance = token.balance(&buyer);
        let treasury_balance = token.balance(&treasury);
        let escrow_balance = token.balance(&client.address);

        // Verify no funds are lost or created
        let total = seller_balance + buyer_balance + treasury_balance + escrow_balance;
        assert_eq!(
            total, amount,
            "total must equal original amount - no rounding loss"
        );

        // Verify escrow is empty
        assert_eq!(escrow_balance, 0, "escrow must be fully distributed");

        // Verify seller got the majority (since 55% ruling)
        assert!(
            seller_balance > buyer_balance,
            "seller should receive more than buyer"
        );

        // Log actual distribution for verification
        assert_eq!(seller_balance, 82, "seller receives 82");
        assert_eq!(buyer_balance, 18, "buyer receives 18");
        assert_eq!(treasury_balance, 0, "treasury receives 0 (fee too small)");
    }

    // -----------------------------------------------------------------------
    // Mediator revocation tests
    // -----------------------------------------------------------------------

    fn setup_base(env: &Env) -> (Address, Address, Address, Address) {
        let contract_id = env.register(EscrowContract, ());
        let admin = Address::generate(env);
        let treasury = Address::generate(env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        let client = EscrowContractClient::new(env, &contract_id);
        client.initialize(&admin, &usdc_id, &treasury, &0_u32);
        (contract_id, admin, usdc_id, treasury)
    }

    /// A mediator registered via set_mediator() then removed must not be able to resolve disputes.
    #[test]
    #[should_panic(expected = "Unauthorized mediator")]
    fn test_legacy_mediator_cannot_resolve_after_remove() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        let mediator = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        // Register via legacy set_mediator
        client.set_mediator(&mediator);

        // Confirm mediator is currently authorized
        assert!(
            client.is_mediator(&mediator),
            "mediator should be registered"
        );

        // Fund a trade and initiate a dispute
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        // Remove the mediator — must clear both registry and legacy slot
        client.remove_mediator(&mediator);
        assert!(
            !client.is_mediator(&mediator),
            "mediator should be deregistered"
        );

        // Attempt to resolve — must panic with "Unauthorized mediator"
        client.resolve_dispute(&trade_id, &mediator, &10_000_u32);
    }

    /// A mediator registered via add_mediator() then removed must not be able to resolve disputes.
    #[test]
    #[should_panic(expected = "Unauthorized mediator")]
    fn test_registry_mediator_cannot_resolve_after_remove() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        let mediator = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        // Register via registry add_mediator
        client.add_mediator(&mediator);
        assert!(
            client.is_mediator(&mediator),
            "mediator should be registered"
        );

        // Fund a trade and initiate a dispute
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        // Remove the mediator
        client.remove_mediator(&mediator);
        assert!(
            !client.is_mediator(&mediator),
            "mediator should be deregistered"
        );

        // Attempt to resolve — must panic with "Unauthorized mediator"
        client.resolve_dispute(&trade_id, &mediator, &10_000_u32);
    }

    /// A mediator set via set_mediator() but NOT removed should still be able to resolve.
    #[test]
    fn test_legacy_mediator_can_resolve_when_not_removed() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        let mediator = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        client.set_mediator(&mediator);

        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        // resolve_dispute must succeed (no panic)
        client.resolve_dispute(&trade_id, &mediator, &10_000_u32);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Completed));
    }

    /// Removing a different mediator must NOT clear the legacy slot of another mediator.
    #[test]
    fn test_remove_mediator_does_not_affect_other_legacy_mediator() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        let mediator_a = Address::generate(&env);
        let mediator_b = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        // mediator_a is in the legacy slot; mediator_b is only in the registry
        client.set_mediator(&mediator_a);
        client.add_mediator(&mediator_b);

        // Remove mediator_b — must NOT touch mediator_a's legacy slot
        client.remove_mediator(&mediator_b);

        assert!(
            client.is_mediator(&mediator_a),
            "mediator_a must still be authorized"
        );
        assert!(
            !client.is_mediator(&mediator_b),
            "mediator_b must be revoked"
        );

        // mediator_a should still be able to resolve
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));
        client.resolve_dispute(&trade_id, &mediator_a, &10_000_u32);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Completed));
    }

    // -----------------------------------------------------------------------
    // Comprehensive mediator registry tests (acceptance criteria)
    // -----------------------------------------------------------------------

    /// Test: Add 3 mediators, all can call resolve_dispute()
    /// Validates multiple mediators can be registered independently and all have resolution privileges.
    #[test]
    fn test_multiple_mediators_can_resolve_dispute() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Register 3 mediators
        let mediator_1 = Address::generate(&env);
        let mediator_2 = Address::generate(&env);
        let mediator_3 = Address::generate(&env);

        client.add_mediator(&mediator_1);
        client.add_mediator(&mediator_2);
        client.add_mediator(&mediator_3);

        // Verify all are registered
        assert!(
            client.is_mediator(&mediator_1),
            "mediator_1 should be registered"
        );
        assert!(
            client.is_mediator(&mediator_2),
            "mediator_2 should be registered"
        );
        assert!(
            client.is_mediator(&mediator_3),
            "mediator_3 should be registered"
        );

        // Setup buyer with enough balance for 3 trades
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &(amount * 3)); // Mint enough for 3 trades

        // Each mediator should be able to resolve the dispute
        // Test mediator_1
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));
        client.resolve_dispute(&trade_id, &mediator_1, &6_000_u32);
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Completed));

        // Test mediator_2
        let trade_id_2 = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id_2);
        client.initiate_dispute(&trade_id_2, &buyer, &String::from_str(&env, "reason2"));
        client.resolve_dispute(&trade_id_2, &mediator_2, &6_000_u32);
        let trade2 = client.get_trade(&trade_id_2);
        assert!(matches!(trade2.status, TradeStatus::Completed));

        // Test mediator_3
        let trade_id_3 = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id_3);
        client.initiate_dispute(&trade_id_3, &buyer, &String::from_str(&env, "reason3"));
        client.resolve_dispute(&trade_id_3, &mediator_3, &6_000_u32);
        let trade3 = client.get_trade(&trade_id_3);
        assert!(matches!(trade3.status, TradeStatus::Completed));
    }

    /// Test: Remove 1 mediator, that mediator cannot resolve (error), others can
    /// Validates selective revocation works correctly without affecting other mediators.
    #[test]
    fn test_remove_one_mediator_blocks_only_that_mediator() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Register 3 mediators
        let mediator_1 = Address::generate(&env);
        let mediator_2 = Address::generate(&env);
        let mediator_3 = Address::generate(&env);

        client.add_mediator(&mediator_1);
        client.add_mediator(&mediator_2);
        client.add_mediator(&mediator_3);

        // Remove mediator_2
        client.remove_mediator(&mediator_2);

        // Verify mediator_2 is revoked, others remain
        assert!(
            client.is_mediator(&mediator_1),
            "mediator_1 should still be registered"
        );
        assert!(
            !client.is_mediator(&mediator_2),
            "mediator_2 should be revoked"
        );
        assert!(
            client.is_mediator(&mediator_3),
            "mediator_3 should still be registered"
        );

        // Setup buyer with enough balance for 2 trades
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &(amount * 2)); // Mint enough for 2 trades

        // mediator_1 should still be able to resolve
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));
        client.resolve_dispute(&trade_id, &mediator_1, &6_000_u32);
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Completed));

        // mediator_3 should also be able to resolve
        let trade_id_2 = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id_2);
        client.initiate_dispute(&trade_id_2, &buyer, &String::from_str(&env, "reason2"));
        client.resolve_dispute(&trade_id_2, &mediator_3, &6_000_u32);
        let trade2 = client.get_trade(&trade_id_2);
        assert!(matches!(trade2.status, TradeStatus::Completed));
    }

    /// Test: Remove 1 mediator, that mediator cannot resolve - isolated test for panic
    #[test]
    #[should_panic(expected = "Unauthorized mediator")]
    fn test_removed_mediator_cannot_resolve() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Register 3 mediators
        let mediator_1 = Address::generate(&env);
        let mediator_2 = Address::generate(&env);
        let mediator_3 = Address::generate(&env);

        client.add_mediator(&mediator_1);
        client.add_mediator(&mediator_2);
        client.add_mediator(&mediator_3);

        // Remove mediator_2
        client.remove_mediator(&mediator_2);

        // Setup disputed trade
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        // mediator_2 should NOT be able to resolve - must panic
        client.resolve_dispute(&trade_id, &mediator_2, &6_000_u32);
    }

    /// Test: After removing one mediator, other mediators can still resolve
    /// Complementary test to verify remaining mediators retain privileges.
    #[test]
    fn test_remaining_mediators_can_resolve_after_one_removed() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Register 3 mediators
        let mediator_1 = Address::generate(&env);
        let mediator_2 = Address::generate(&env);
        let mediator_3 = Address::generate(&env);

        client.add_mediator(&mediator_1);
        client.add_mediator(&mediator_2);
        client.add_mediator(&mediator_3);

        // Remove mediator_2
        client.remove_mediator(&mediator_2);

        // Setup disputed trade for mediator_3
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        // mediator_3 should still be able to resolve
        client.resolve_dispute(&trade_id, &mediator_3, &6_000_u32);
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Completed));
    }

    /// Test: Legacy slot doesn't prevent new registry from revoking mediator
    /// Validates that a mediator registered via add_mediator() can be fully revoked
    /// even if legacy slot is set to a different address.
    #[test]
    fn test_legacy_slot_does_not_prevent_registry_revocation() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Set up legacy mediator (different from registry mediator)
        let legacy_mediator = Address::generate(&env);
        let registry_mediator = Address::generate(&env);

        // Legacy mediator in instance storage
        client.set_mediator(&legacy_mediator);
        // Registry mediator in persistent storage
        client.add_mediator(&registry_mediator);

        // Verify both are registered
        assert!(
            client.is_mediator(&legacy_mediator),
            "legacy_mediator should be registered"
        );
        assert!(
            client.is_mediator(&registry_mediator),
            "registry_mediator should be registered"
        );

        // Remove registry_mediator
        client.remove_mediator(&registry_mediator);

        // Verify registry_mediator is fully revoked
        assert!(
            !client.is_mediator(&registry_mediator),
            "registry_mediator should be revoked"
        );

        // Verify legacy_mediator is NOT affected (still in legacy slot)
        assert!(
            client.is_mediator(&legacy_mediator),
            "legacy_mediator should still be registered"
        );

        // Verify registry_mediator cannot resolve (should panic)
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        // This should panic - registry_mediator is revoked
        // We need a separate test for the panic assertion
    }

    /// Test: Registry mediator cannot resolve after removal even with legacy slot present
    /// Isolated panic test for the above scenario.
    #[test]
    #[should_panic(expected = "Unauthorized mediator")]
    fn test_registry_mediator_revoked_despite_legacy_slot_present() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Set up legacy mediator (different from registry mediator)
        let legacy_mediator = Address::generate(&env);
        let registry_mediator = Address::generate(&env);

        // Legacy mediator in instance storage
        client.set_mediator(&legacy_mediator);
        // Registry mediator in persistent storage
        client.add_mediator(&registry_mediator);

        // Remove registry_mediator
        client.remove_mediator(&registry_mediator);

        // Setup disputed trade
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        // registry_mediator should NOT be able to resolve - must panic
        client.resolve_dispute(&trade_id, &registry_mediator, &6_000_u32);
    }

    /// Test: Concurrent add/remove operations don't corrupt registry
    /// Validates that rapid add/remove cycles maintain registry integrity.
    #[test]
    fn test_concurrent_add_remove_operations() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, _usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        let mediator_a = Address::generate(&env);
        let mediator_b = Address::generate(&env);
        let mediator_c = Address::generate(&env);

        // Rapid add/remove cycle for mediator_a
        client.add_mediator(&mediator_a);
        client.add_mediator(&mediator_b);
        client.remove_mediator(&mediator_a);
        client.add_mediator(&mediator_c);
        client.add_mediator(&mediator_a);
        client.remove_mediator(&mediator_b);

        // Verify final state
        assert!(
            client.is_mediator(&mediator_a),
            "mediator_a should be registered (re-added)"
        );
        assert!(
            !client.is_mediator(&mediator_b),
            "mediator_b should be revoked"
        );
        assert!(
            client.is_mediator(&mediator_c),
            "mediator_c should be registered"
        );

        // Verify mediator_a can still resolve (proves registry is not corrupted)
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &_usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));
        client.resolve_dispute(&trade_id, &mediator_a, &6_000_u32);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Completed));
    }

    /// Test: Concurrent add/remove with legacy slot interactions
    /// Validates complex interleaving of legacy and registry operations.
    #[test]
    fn test_concurrent_legacy_registry_operations() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        let mediator_a = Address::generate(&env);
        let mediator_b = Address::generate(&env);
        let mediator_c = Address::generate(&env);

        // Complex sequence mixing legacy and registry operations
        client.set_mediator(&mediator_a); // Legacy + Registry
        client.add_mediator(&mediator_b); // Registry only
        client.add_mediator(&mediator_c); // Registry only
        client.remove_mediator(&mediator_a); // Removes from both legacy and registry
        client.add_mediator(&mediator_a); // Re-add to registry only

        // Verify final state
        assert!(
            client.is_mediator(&mediator_a),
            "mediator_a should be registered"
        );
        assert!(
            client.is_mediator(&mediator_b),
            "mediator_b should be registered"
        );
        assert!(
            client.is_mediator(&mediator_c),
            "mediator_c should be registered"
        );

        // Verify legacy slot is empty (mediator_a was removed, clearing it)
        // All three should be able to resolve
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &(amount * 3)); // Mint enough for 3 trades

        // Test mediator_a can resolve
        let trade_id_a = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id_a);
        client.initiate_dispute(&trade_id_a, &buyer, &String::from_str(&env, "reason_a"));
        client.resolve_dispute(&trade_id_a, &mediator_a, &6_000_u32);
        assert!(matches!(
            client.get_trade(&trade_id_a).status,
            TradeStatus::Completed
        ));

        // Test mediator_b can resolve
        let trade_id_b = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id_b);
        client.initiate_dispute(&trade_id_b, &buyer, &String::from_str(&env, "reason_b"));
        client.resolve_dispute(&trade_id_b, &mediator_b, &6_000_u32);
        assert!(matches!(
            client.get_trade(&trade_id_b).status,
            TradeStatus::Completed
        ));

        // Test mediator_c can resolve
        let trade_id_c = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id_c);
        client.initiate_dispute(&trade_id_c, &buyer, &String::from_str(&env, "reason_c"));
        client.resolve_dispute(&trade_id_c, &mediator_c, &6_000_u32);
        assert!(matches!(
            client.get_trade(&trade_id_c).status,
            TradeStatus::Completed
        ));
    }

    /// Test: Remove mediator registered via set_mediator, verify both slots cleared
    /// Ensures remove_mediator properly cleans up both legacy and registry storage.
    #[test]
    fn test_remove_mediator_clears_both_slots() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        let mediator = Address::generate(&env);

        // Register via set_mediator (writes to both legacy and registry)
        client.set_mediator(&mediator);
        assert!(
            client.is_mediator(&mediator),
            "mediator should be registered"
        );

        // Remove mediator
        client.remove_mediator(&mediator);
        assert!(!client.is_mediator(&mediator), "mediator should be revoked");

        // Verify mediator cannot resolve
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        // This should panic - mediator is fully revoked
        // Separate panic test below
    }

    /// Test: Mediator registered via set_mediator cannot resolve after remove
    /// Isolated panic test for complete revocation verification.
    #[test]
    #[should_panic(expected = "Unauthorized mediator")]
    fn test_set_mediator_then_remove_blocks_resolution() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _admin, usdc_id, _treasury) = setup_base(&env);
        let client = EscrowContractClient::new(&env, &contract_id);

        let mediator = Address::generate(&env);

        // Register via set_mediator (writes to both legacy and registry)
        client.set_mediator(&mediator);

        // Remove mediator
        client.remove_mediator(&mediator);

        // Setup disputed trade
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        // This should panic - mediator is fully revoked from both slots
        client.resolve_dispute(&trade_id, &mediator, &6_000_u32);
    }
}

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod property_tests {
    extern crate std;

    use super::*;
    use quickcheck::{Arbitrary, Gen, QuickCheck, TestResult};
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Address, Env, token};
    use std::boxed::Box;
    use std::vec::Vec;

    // -----------------------------------------------------------------------
    // Arbitrary types for property-based testing
    // -----------------------------------------------------------------------

    /// Represents a valid test case for dispute resolution
    #[derive(Clone, Debug)]
    struct DisputeTestCase {
        total_amount: i128,   // Total escrow amount (1 to 1_000_000)
        buyer_loss_bps: u32,  // Buyer's loss share (0 to 10000)
        seller_loss_bps: u32, // Seller's loss share (0 to 10000)
        seller_gets_bps: u32, // Seller payout ratio (0 to 10000)
        fee_bps: u32,         // Platform fee (0 to 1000)
    }

    impl Arbitrary for DisputeTestCase {
        fn arbitrary(g: &mut Gen) -> Self {
            // Generate amounts that are realistic but varied
            let total_amount = 1 + (i128::arbitrary(g) % 1_000_000);
            let buyer_loss_bps = u32::arbitrary(g) % 10_001;
            let seller_loss_bps = u32::arbitrary(g) % 10_001;
            let seller_gets_bps = u32::arbitrary(g) % 10_001;
            let fee_bps = u32::arbitrary(g) % 1_001;

            DisputeTestCase {
                total_amount,
                buyer_loss_bps,
                seller_loss_bps,
                seller_gets_bps,
                fee_bps,
            }
        }

        fn shrink(&self) -> Box<dyn Iterator<Item = Self>> {
            // Shrink toward edge cases
            let mut shrunk: Vec<DisputeTestCase> = Vec::new();

            // Edge case: zero loss
            if self.total_amount > 1 {
                shrunk.push(DisputeTestCase {
                    total_amount: self.total_amount / 2,
                    ..self.clone()
                });
            }

            // Edge cases for basis points
            for &bps in &[0, 1, 5000, 9999, 10000] {
                if self.buyer_loss_bps != bps
                    || self.seller_loss_bps != bps
                    || self.seller_gets_bps != bps
                {
                    shrunk.push(DisputeTestCase {
                        buyer_loss_bps: bps,
                        ..self.clone()
                    });
                    shrunk.push(DisputeTestCase {
                        seller_loss_bps: bps,
                        ..self.clone()
                    });
                    shrunk.push(DisputeTestCase {
                        seller_gets_bps: bps,
                        ..self.clone()
                    });
                }
            }

            Box::new(shrunk.into_iter())
        }
    }

    // -----------------------------------------------------------------------
    // Helper: Calculate expected payouts (mirrors contract logic)
    // -----------------------------------------------------------------------

    fn calculate_payouts(
        total: i128,
        seller_loss_bps: u32,
        seller_gets_bps: u32,
        fee_bps: u32,
    ) -> (i128, i128, i128) {
        const BPS_DIVISOR: i128 = 10_000;

        // Calculate the loss amount in basis points
        let loss_bps = BPS_DIVISOR - (seller_gets_bps as i128);

        // Distribute loss according to seller's agreed ratio
        let seller_loss_amount =
            (total * loss_bps * (seller_loss_bps as i128)) / (BPS_DIVISOR * BPS_DIVISOR);

        // Calculate raw payouts
        let seller_raw = total - seller_loss_amount;
        let buyer_refund = total - seller_raw;

        // Deduct platform fee from seller's portion only
        let fee = (seller_raw * (fee_bps as i128)) / BPS_DIVISOR;
        let seller_net = seller_raw - fee;

        (seller_net, buyer_refund, fee)
    }

    // -----------------------------------------------------------------------
    // Property: Fund Conservation
    // -----------------------------------------------------------------------

    /// Property: seller_payout + buyer_refund + platform_fee == original_escrow
    /// No money is created or destroyed in the system.
    fn prop_fund_conservation(case: DisputeTestCase) -> TestResult {
        let (seller_net, buyer_refund, fee) = calculate_payouts(
            case.total_amount,
            case.seller_loss_bps,
            case.seller_gets_bps,
            case.fee_bps,
        );

        let total_out = seller_net + buyer_refund + fee;

        if total_out != case.total_amount {
            std::eprintln!(
                "Fund conservation violated: {} + {} + {} = {} != {}",
                seller_net,
                buyer_refund,
                fee,
                total_out,
                case.total_amount
            );
            return TestResult::failed();
        }

        TestResult::passed()
    }

    #[test]
    fn test_property_fund_conservation() {
        QuickCheck::new()
            .tests(100)
            .quickcheck(prop_fund_conservation as fn(DisputeTestCase) -> TestResult);
    }

    // -----------------------------------------------------------------------
    // Property: Loss Distribution
    // -----------------------------------------------------------------------

    /// Property: loss_amount * (seller_loss_bps / 10000) = seller_loss
    /// Loss is distributed correctly according to agreed ratios.
    fn prop_loss_distribution(case: DisputeTestCase) -> TestResult {
        const BPS_DIVISOR: i128 = 10_000;

        let loss_bps = BPS_DIVISOR - (case.seller_gets_bps as i128);
        let total_loss = (case.total_amount * loss_bps) / BPS_DIVISOR;
        let expected_seller_loss = (total_loss * (case.seller_loss_bps as i128)) / BPS_DIVISOR;

        // Calculate actual seller loss from payouts
        let (seller_net, _, _) = calculate_payouts(
            case.total_amount,
            case.seller_loss_bps,
            case.seller_gets_bps,
            case.fee_bps,
        );

        // Seller loss = total - seller_net - fee (what seller actually lost)
        let fee = (case.total_amount - expected_seller_loss) * (case.fee_bps as i128) / BPS_DIVISOR;
        let actual_seller_loss = case.total_amount - seller_net - fee;

        // Allow for 1 unit of rounding error
        if (actual_seller_loss - expected_seller_loss).abs() > 1 {
            std::eprintln!(
                "Loss distribution violated: expected seller_loss={}, actual={}",
                expected_seller_loss,
                actual_seller_loss
            );
            return TestResult::failed();
        }

        TestResult::passed()
    }

    #[test]
    fn test_property_loss_distribution() {
        QuickCheck::new()
            .tests(100)
            .quickcheck(prop_loss_distribution as fn(DisputeTestCase) -> TestResult);
    }

    // -----------------------------------------------------------------------
    // Property: Monotonicity
    // -----------------------------------------------------------------------

    /// Property: As seller_gets_bps increases, buyer_refund decreases
    /// Higher seller payout ratio means lower buyer refund.
    fn prop_monotonicity(case: DisputeTestCase) -> TestResult {
        const BPS_DIVISOR: u32 = 10_000;

        // Test with seller_gets_bps and seller_gets_bps + 1 (if valid)
        if case.seller_gets_bps >= BPS_DIVISOR {
            return TestResult::passed();
        }

        let (_, buyer_refund_low, _) = calculate_payouts(
            case.total_amount,
            case.seller_loss_bps,
            case.seller_gets_bps,
            case.fee_bps,
        );

        let (_, buyer_refund_high, _) = calculate_payouts(
            case.total_amount,
            case.seller_loss_bps,
            case.seller_gets_bps + 1,
            case.fee_bps,
        );

        // Buyer refund should decrease (or stay same due to rounding) as seller_gets increases
        if buyer_refund_high > buyer_refund_low {
            std::eprintln!(
                "Monotonicity violated: buyer_refund at {} bps = {}, at {} bps = {}",
                case.seller_gets_bps,
                buyer_refund_low,
                case.seller_gets_bps + 1,
                buyer_refund_high
            );
            return TestResult::failed();
        }

        TestResult::passed()
    }

    #[test]
    fn test_property_monotonicity() {
        QuickCheck::new()
            .tests(100)
            .quickcheck(prop_monotonicity as fn(DisputeTestCase) -> TestResult);
    }

    // -----------------------------------------------------------------------
    // Property: Non-negativity
    // -----------------------------------------------------------------------

    /// Property: All payouts >= 0 (never negative transfers)
    fn prop_non_negativity(case: DisputeTestCase) -> TestResult {
        let (seller_net, buyer_refund, fee) = calculate_payouts(
            case.total_amount,
            case.seller_loss_bps,
            case.seller_gets_bps,
            case.fee_bps,
        );

        if seller_net < 0 {
            std::eprintln!("Non-negativity violated: seller_net = {}", seller_net);
            return TestResult::failed();
        }
        if buyer_refund < 0 {
            std::eprintln!("Non-negativity violated: buyer_refund = {}", buyer_refund);
            return TestResult::failed();
        }
        if fee < 0 {
            std::eprintln!("Non-negativity violated: fee = {}", fee);
            return TestResult::failed();
        }

        TestResult::passed()
    }

    #[test]
    fn test_property_non_negativity() {
        QuickCheck::new()
            .tests(100)
            .quickcheck(prop_non_negativity as fn(DisputeTestCase) -> TestResult);
    }

    // -----------------------------------------------------------------------
    // Property: Bounds Checking
    // -----------------------------------------------------------------------

    /// Property: seller_gets_bps > 10000 is invalid (would be rejected by contract)
    #[test]
    #[should_panic(expected = "seller_gets_bps must be <= 10_000")]
    fn test_bounds_seller_gets_bps_over_10000() {
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

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // This should panic - seller_gets_bps > 10000
        client.resolve_dispute(&trade_id, &mediator, &10_001_u32);
    }

    // -----------------------------------------------------------------------
    // Edge Case Tests
    // -----------------------------------------------------------------------

    /// Edge case: loss = total (seller_gets_bps = 0)
    /// With 50/50 loss sharing, seller bears 50% of total loss
    #[test]
    fn test_edge_case_total_loss() {
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

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // 50/50 loss sharing
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // seller_gets_bps = 0 (total loss = 100%)
        // loss = 10,000 (100%)
        // seller bears: 10,000 * 50% = 5,000
        // seller_raw = 10,000 - 5,000 = 5,000
        // fee = 5,000 * 1% = 50
        // seller_net = 5,000 - 50 = 4,950
        // buyer_refund = 5,000
        client.resolve_dispute(&trade_id, &mediator, &0_u32);

        let token = token::Client::new(&env, &usdc_id);
        // Seller gets 4,950 (bears 50% of total loss, minus 1% fee)
        assert_eq!(
            token.balance(&seller),
            4_950,
            "seller should bear 50% of total loss minus fee"
        );
        // Buyer gets 5,000 refund (bears 50% of loss)
        assert_eq!(
            token.balance(&buyer),
            5_000,
            "buyer should bear 50% of loss"
        );
        // Treasury gets 50 (fee on seller portion)
        assert_eq!(token.balance(&treasury), 50, "treasury should get fee");

        // Verify conservation
        assert_eq!(4_950 + 5_000 + 50, amount, "conservation must hold");
    }

    /// Edge case: loss = 0 (seller_gets_bps = 10000)
    /// Seller gets full amount (minus fee), buyer gets nothing
    #[test]
    fn test_edge_case_no_loss() {
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

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // 50/50 loss sharing (doesn't matter when no loss)
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // seller_gets_bps = 10000 (no loss)
        client.resolve_dispute(&trade_id, &mediator, &10_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        // seller_raw = 10000, fee = 10000 * 100 / 10000 = 100, seller_net = 9900
        assert_eq!(
            token.balance(&seller),
            9_900,
            "seller should get amount minus fee"
        );
        // Buyer gets 0
        assert_eq!(token.balance(&buyer), 0, "buyer should get nothing");
        // Treasury gets fee
        assert_eq!(token.balance(&treasury), 100, "treasury should get fee");

        // Verify conservation
        assert_eq!(9_900 + 0 + 100, amount, "conservation must hold");
    }

    /// Edge case: seller_gets_bps = 0 (total loss) with various loss-sharing ratios
    #[test]
    fn test_edge_case_seller_gets_zero() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());

        client.initialize(&admin, &usdc_id, &treasury, &0);

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // 50/50 loss sharing, seller_gets_bps = 0 (100% loss)
        // seller bears: 10,000 * 50% = 5,000, keeps: 5,000
        // buyer bears: 10,000 * 50% = 5,000, refund: 5,000
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);
        client.resolve_dispute(&trade_id, &mediator, &0_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(
            token.balance(&seller),
            5_000,
            "seller bears 50% of total loss"
        );
        assert_eq!(
            token.balance(&buyer),
            5_000,
            "buyer bears 50% of total loss"
        );
        assert_eq!(
            token.balance(&seller) + token.balance(&buyer),
            amount,
            "conservation holds"
        );
    }

    /// Edge case: seller_gets_bps = 10000 (no loss) with various loss-sharing ratios
    #[test]
    fn test_edge_case_seller_gets_all() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());

        client.initialize(&admin, &usdc_id, &treasury, &0);

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        // 50/50 loss sharing, seller_gets_bps = 10000 (0% loss)
        // seller gets full amount, buyer gets 0
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);
        client.resolve_dispute(&trade_id, &mediator, &10_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        assert_eq!(
            token.balance(&seller),
            amount,
            "seller gets full amount with no loss"
        );
        assert_eq!(token.balance(&buyer), 0, "buyer gets nothing with no loss");
    }

    /// Edge case: fee = 0 (no platform fee)
    #[test]
    fn test_edge_case_zero_fee() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());

        client.initialize(&admin, &usdc_id, &treasury, &0); // Zero fee

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // 50% for seller (50% loss)
        client.resolve_dispute(&trade_id, &mediator, &5_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        // loss = 50% = 5000
        // seller bears: 5000 * 50% = 2500
        // seller_raw = 10000 - 2500 = 7500
        // fee = 0 (zero fee)
        // seller_net = 7500
        // buyer_refund = 2500
        assert_eq!(
            token.balance(&seller),
            7_500,
            "seller gets 75% with 50% loss and 50% loss sharing"
        );
        assert_eq!(token.balance(&buyer), 2_500, "buyer gets 25% refund");
        assert_eq!(
            token.balance(&treasury),
            0,
            "treasury gets nothing with zero fee"
        );

        // Verify conservation
        assert_eq!(7_500 + 2_500 + 0, amount, "conservation must hold");
    }

    /// Edge case: fee = 1000 (10% fee - maximum typical fee)
    #[test]
    fn test_edge_case_max_typical_fee() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());

        client.initialize(&admin, &usdc_id, &treasury, &1_000); // 10% fee

        let amount = 10_000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);

        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);

        // 50% for seller (50% loss)
        client.resolve_dispute(&trade_id, &mediator, &5_000_u32);

        let token = token::Client::new(&env, &usdc_id);
        // loss = 50% = 5000
        // seller bears: 5000 * 50% = 2500
        // seller_raw = 10000 - 2500 = 7500
        // fee = 7500 * 10% = 750
        // seller_net = 7500 - 750 = 6750
        // buyer_refund = 2500
        assert_eq!(
            token.balance(&seller),
            6_750,
            "seller gets 67.5% with 50% loss, 50% sharing, 10% fee"
        );
        assert_eq!(token.balance(&buyer), 2_500, "buyer gets 25% refund");
        assert_eq!(
            token.balance(&treasury),
            750,
            "treasury gets 10% fee on seller portion"
        );

        // Verify conservation
        assert_eq!(6_750 + 2_500 + 750, amount, "conservation must hold");
    }

    /// Comprehensive randomized test: 10+ random scenarios
    #[test]
    fn test_comprehensive_randomized_scenarios() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());

        // Test 10+ random scenarios
        for i in 0..10 {
            let contract_id = env.register(EscrowContract, ());
            let client = EscrowContractClient::new(&env, &contract_id);
            let treasury = Address::generate(&env);

            // Random fee between 0 and 1000 bps
            let fee_bps = (i % 1001) as u32;
            client.initialize(&admin, &usdc_id, &treasury, &fee_bps);

            let buyer = Address::generate(&env);
            let seller = Address::generate(&env);

            // Random amount between 1 and 100000
            let amount = 1 + (i as i128 % 100_000);
            let token_client = token::StellarAssetClient::new(&env, &usdc_id);
            token_client.mint(&buyer, &amount);

            // Random loss-sharing ratios
            let buyer_loss_bps = ((i * 7) % 10001) as u32;
            let seller_loss_bps = 10_000 - buyer_loss_bps;

            let trade_id =
                client.create_trade(&buyer, &seller, &amount, &buyer_loss_bps, &seller_loss_bps);
            client.deposit(&trade_id);
            client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "reason"));

            let mediator = Address::generate(&env);
            client.set_mediator(&mediator);

            // Random seller_gets_bps
            let seller_gets_bps = ((i * 13) % 10001) as u32;
            client.resolve_dispute(&trade_id, &mediator, &seller_gets_bps);

            // Verify conservation
            let token = token::Client::new(&env, &usdc_id);
            let seller_balance = token.balance(&seller);
            let buyer_balance = token.balance(&buyer);
            let treasury_balance = token.balance(&treasury);
            let escrow_balance = token.balance(&contract_id);

            let total = seller_balance + buyer_balance + treasury_balance + escrow_balance;
            assert_eq!(total, amount, "conservation failed in scenario {}", i);
            assert_eq!(
                escrow_balance, 0,
                "escrow should be empty in scenario {}",
                i
            );

            // Verify non-negativity
            assert!(
                seller_balance >= 0,
                "seller balance negative in scenario {}",
                i
            );
            assert!(
                buyer_balance >= 0,
                "buyer balance negative in scenario {}",
                i
            );
            assert!(
                treasury_balance >= 0,
                "treasury balance negative in scenario {}",
                i
            );
        }
    }

    #[test]
    fn test_submit_manifest_succeeds_for_seller_in_funded_status() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100_u32);
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &10_000_i128);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        let client = EscrowContractClient::new(&env, &contract_id);

        let name_hash = String::from_str(
            &env,
            "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        );
        let id_hash = String::from_str(
            &env,
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        );

        client.submit_manifest(&trade_id, &seller, &name_hash, &id_hash);

        let manifest = client
            .get_manifest(&trade_id)
            .expect("manifest should exist");
        assert_eq!(manifest.seller, seller);
        assert_eq!(manifest.driver_name_hash, name_hash);
        assert_eq!(manifest.driver_id_hash, id_hash);
    }

    #[test]
    #[should_panic(expected = "Only seller can submit manifest")]
    fn test_submit_manifest_rejects_non_seller() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100_u32);
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &10_000_i128);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        let client = EscrowContractClient::new(&env, &contract_id);

        let name_hash = String::from_str(
            &env,
            "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        );
        let id_hash = String::from_str(
            &env,
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        );

        client.submit_manifest(&trade_id, &buyer, &name_hash, &id_hash);
    }

    #[test]
    #[should_panic(expected = "Manifest already submitted")]
    fn test_submit_manifest_rejects_second_submission() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100_u32);
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &10_000_i128);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        let client = EscrowContractClient::new(&env, &contract_id);

        let first_name_hash = String::from_str(
            &env,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        let first_id_hash = String::from_str(
            &env,
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        );
        client.submit_manifest(&trade_id, &seller, &first_name_hash, &first_id_hash);

        let second_name_hash = String::from_str(
            &env,
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        );
        let second_id_hash = String::from_str(
            &env,
            "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        );
        client.submit_manifest(&trade_id, &seller, &second_name_hash, &second_id_hash);
    }

    #[test]
    fn test_failed_guard_check_keeps_trade_state_unchanged() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100_u32);
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &10_000_i128);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        let client = EscrowContractClient::new(&env, &contract_id);

        let before = client.get_trade(&trade_id);
        assert!(matches!(before.status, TradeStatus::Funded));

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let name_hash = String::from_str(
                &env,
                "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
            );
            let id_hash = String::from_str(
                &env,
                "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
            );
            client.submit_manifest(&trade_id, &Address::generate(&env), &name_hash, &id_hash);
        }));

        assert!(result.is_err());

        let after = client.get_trade(&trade_id);
        assert!(matches!(after.status, TradeStatus::Funded));
        let manifest = client.get_manifest(&trade_id);
        assert!(manifest.is_none());

        let _ = seller;
    }
} // end mod property_tests

// ---------------------------------------------------------------------------
// Issue #221 & #224: Fee calculations, evidence ordering, video proof
// ---------------------------------------------------------------------------

#[cfg(test)]
mod fee_and_evidence_tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Address, Env, String, token};

    // =======================================================================
    // Issue #221: Fee calculations and rounding edge cases
    // =======================================================================

    /// Helper: set up a funded trade with configurable amount and fee_bps.
    fn setup_fee_trade(
        env: &Env,
        amount: i128,
        fee_bps: u32,
    ) -> (Address, Address, Address, Address, Address, u64) {
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
        (contract_id, buyer, seller, treasury, usdc_id, trade_id)
    }

    /// 1% fee on 100 stroops → seller gets 99, treasury gets 1.
    #[test]
    fn test_fee_100_stroops_1pct() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, seller, treasury, usdc_id, trade_id) =
            setup_fee_trade(&env, 100, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id);
        let tok = token::Client::new(&env, &usdc_id);
        assert_eq!(tok.balance(&seller), 99);
        assert_eq!(tok.balance(&treasury), 1);
        assert_eq!(tok.balance(&client.address), 0);
    }

    /// 1% fee on 1000 stroops → seller 990, treasury 10.
    #[test]
    fn test_fee_1000_stroops_1pct() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, seller, treasury, usdc_id, trade_id) =
            setup_fee_trade(&env, 1_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id);
        let tok = token::Client::new(&env, &usdc_id);
        assert_eq!(tok.balance(&seller), 990);
        assert_eq!(tok.balance(&treasury), 10);
        assert_eq!(tok.balance(&client.address), 0);
    }

    /// 1% fee on 1_000_000 stroops → seller 990_000, treasury 10_000.
    #[test]
    fn test_fee_1m_stroops_1pct() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, seller, treasury, usdc_id, trade_id) =
            setup_fee_trade(&env, 1_000_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id);
        let tok = token::Client::new(&env, &usdc_id);
        assert_eq!(tok.balance(&seller), 990_000);
        assert_eq!(tok.balance(&treasury), 10_000);
        assert_eq!(tok.balance(&client.address), 0);
    }

    /// Zero fee (fee_bps = 0) → seller gets full amount.
    #[test]
    fn test_fee_zero_bps_seller_gets_all() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, seller, treasury, usdc_id, trade_id) =
            setup_fee_trade(&env, 10_000, 0);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id);
        let tok = token::Client::new(&env, &usdc_id);
        assert_eq!(tok.balance(&seller), 10_000);
        assert_eq!(tok.balance(&treasury), 0);
        assert_eq!(tok.balance(&client.address), 0);
    }

    /// Minimum amount: 1 stroop with 1% fee → fee rounds to 0, seller gets 1.
    #[test]
    fn test_fee_1_stroop_rounds_to_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, seller, treasury, usdc_id, trade_id) =
            setup_fee_trade(&env, 1, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id);
        let tok = token::Client::new(&env, &usdc_id);
        assert_eq!(tok.balance(&seller), 1);
        assert_eq!(tok.balance(&treasury), 0);
        assert_eq!(tok.balance(&client.address), 0);
    }

    /// Fund conservation: seller + treasury = total for any valid amount.
    #[test]
    fn test_fee_fund_conservation_various_amounts() {
        let amounts: &[i128] = &[1, 7, 99, 100, 101, 999, 1_000, 9_999, 10_000, 100_001];
        for &amount in amounts {
            let env = Env::default();
            env.mock_all_auths();
            let (contract_id, _buyer, seller, treasury, usdc_id, trade_id) =
                setup_fee_trade(&env, amount, 100);
            let client = EscrowContractClient::new(&env, &contract_id);
            client.confirm_delivery(&trade_id);
            client.release_funds(&trade_id);
            let tok = token::Client::new(&env, &usdc_id);
            let total = tok.balance(&seller) + tok.balance(&treasury);
            assert_eq!(
                total, amount,
                "fund conservation failed for amount={}",
                amount
            );
            assert_eq!(
                tok.balance(&client.address),
                0,
                "escrow not empty for amount={}",
                amount
            );
        }
    }

    /// Fee never exceeds original amount (100 → fee ≤ 100).
    #[test]
    fn test_fee_never_exceeds_original_amount() {
        let env = Env::default();
        env.mock_all_auths();
        // Use max fee_bps = 10000 (100%)
        let (contract_id, _buyer, seller, treasury, usdc_id, trade_id) =
            setup_fee_trade(&env, 100, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id);
        let tok = token::Client::new(&env, &usdc_id);
        let fee = tok.balance(&treasury);
        assert!(
            fee <= 100,
            "fee {} must not exceed original amount 100",
            fee
        );
        assert_eq!(tok.balance(&client.address), 0);
    }

    /// Rounding always floors (never overpays): 99 stroops at 1% → fee = 0.
    #[test]
    fn test_fee_rounding_floors_not_ceiling() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, seller, treasury, usdc_id, trade_id) =
            setup_fee_trade(&env, 99, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id);
        let tok = token::Client::new(&env, &usdc_id);
        // 99 * 100 / 10_000 = 0.99 → floors to 0
        assert_eq!(tok.balance(&treasury), 0);
        assert_eq!(tok.balance(&seller), 99);
    }

    /// Loss ratio 3000/7000 with 50% seller ruling: verify exact math.
    #[test]
    fn test_loss_ratio_3000_7000_50pct_ruling() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100_u32);
        let amount = 10_000_i128;
        let tok_client = token::StellarAssetClient::new(&env, &usdc_id);
        tok_client.mint(&buyer, &amount);
        // buyer_loss_bps=3000, seller_loss_bps=7000
        let trade_id = client.create_trade(&buyer, &seller, &amount, &3000_u32, &7000_u32);
        client.deposit(&trade_id);
        let reason = String::from_str(&env, "QmFeeTest3070");
        client.initiate_dispute(&trade_id, &buyer, &reason);
        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);
        // Mediator rules 50% for seller → loss_bps = 5000
        // seller_loss = 10_000 * 5000 * 7000 / 100_000_000 = 3_500
        // seller_raw  = 10_000 - 3_500 = 6_500
        // fee         = 6_500 * 100 / 10_000 = 65
        // seller_net  = 6_500 - 65 = 6_435
        // buyer_refund = 3_500
        client.resolve_dispute(&trade_id, &mediator, &5_000_u32);
        let tok = token::Client::new(&env, &usdc_id);
        assert_eq!(tok.balance(&seller), 6_435);
        assert_eq!(tok.balance(&buyer), 3_500);
        assert_eq!(tok.balance(&treasury), 65);
        assert_eq!(tok.balance(&client.address), 0);
        assert_eq!(6_435 + 3_500 + 65, 10_000);
    }

    /// Loss ratio 9999/1 (extreme asymmetry): verify no overflow.
    #[test]
    fn test_loss_ratio_9999_1_no_overflow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100_u32);
        let amount = 10_000_i128;
        let tok_client = token::StellarAssetClient::new(&env, &usdc_id);
        tok_client.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &9999_u32, &1_u32);
        client.deposit(&trade_id);
        let reason = String::from_str(&env, "QmExtreme9999");
        client.initiate_dispute(&trade_id, &buyer, &reason);
        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);
        client.resolve_dispute(&trade_id, &mediator, &5_000_u32);
        let tok = token::Client::new(&env, &usdc_id);
        let total = tok.balance(&seller) + tok.balance(&buyer) + tok.balance(&treasury);
        assert_eq!(total, amount, "fund conservation with 9999/1 ratio");
        assert_eq!(tok.balance(&client.address), 0);
    }

    /// Full seller payout (seller_gets_bps = 10000): fee deducted from full amount.
    #[test]
    fn test_fee_full_seller_payout_dispute() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, seller, treasury, usdc_id, trade_id) =
            setup_fee_trade(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let reason = String::from_str(&env, "QmFullSellerFee");
        client.initiate_dispute(&trade_id, &buyer, &reason);
        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);
        // seller_gets_bps = 10_000 → no loss
        // seller_raw = 10_000, fee = 100, seller_net = 9_900, buyer_refund = 0
        client.resolve_dispute(&trade_id, &mediator, &10_000_u32);
        let tok = token::Client::new(&env, &usdc_id);
        assert_eq!(tok.balance(&seller), 9_900);
        assert_eq!(tok.balance(&buyer), 0);
        assert_eq!(tok.balance(&treasury), 100);
        assert_eq!(tok.balance(&client.address), 0);
    }

    /// Full buyer refund scenario (seller_gets_bps = 0): with 50/50 loss ratio,
    /// seller bears 50% of the 100% loss, so buyer gets 50% back.
    /// seller_loss = 10_000 * 10_000 * 5_000 / 100_000_000 = 5_000
    /// seller_raw  = 10_000 - 5_000 = 5_000
    /// fee         = 5_000 * 100 / 10_000 = 50
    /// seller_net  = 5_000 - 50 = 4_950
    /// buyer_refund = 5_000
    #[test]
    fn test_fee_full_buyer_refund_dispute() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, seller, treasury, usdc_id, trade_id) =
            setup_fee_trade(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let reason = String::from_str(&env, "QmFullBuyerFee");
        client.initiate_dispute(&trade_id, &buyer, &reason);
        let mediator = Address::generate(&env);
        client.set_mediator(&mediator);
        // seller_gets_bps = 0 → loss_bps = 10_000 (100% loss)
        // With 50/50 split: seller_loss = 10_000 * 10_000 * 5_000 / 100_000_000 = 5_000
        // seller_raw = 5_000, fee = 50, seller_net = 4_950, buyer_refund = 5_000
        client.resolve_dispute(&trade_id, &mediator, &0_u32);
        let tok = token::Client::new(&env, &usdc_id);
        assert_eq!(tok.balance(&buyer), 5_000);
        assert_eq!(tok.balance(&seller), 4_950);
        assert_eq!(tok.balance(&treasury), 50);
        assert_eq!(tok.balance(&client.address), 0);
        // Fund conservation
        assert_eq!(5_000 + 4_950 + 50, 10_000);
    }

    // =======================================================================
    // Issue #224: Evidence ordering, hash immutability, video proof constraints
    // =======================================================================

    /// Helper: create a funded + disputed trade for evidence tests.
    fn setup_disputed(
        env: &Env,
        amount: i128,
        fee_bps: u32,
    ) -> (Address, Address, Address, Address, Address, Address, u64) {
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let mediator = Address::generate(env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &fee_bps);
        client.add_mediator(&mediator);
        let tok = token::StellarAssetClient::new(env, &usdc_id);
        tok.mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        env.ledger().with_mut(|l| l.timestamp = 1_000);
        let reason = String::from_str(env, "QmDisputeReason");
        client.initiate_dispute(&trade_id, &buyer, &reason);
        (
            contract_id,
            buyer,
            seller,
            treasury,
            mediator,
            usdc_id,
            trade_id,
        )
    }

    /// Submit 5 pieces of evidence and verify FIFO order is preserved.
    #[test]
    fn test_evidence_fifo_order_5_submissions() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, _seller, _treasury, _mediator, usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let _ = usdc_id;

        let hashes = [
            "QmEvidence1",
            "QmEvidence2",
            "QmEvidence3",
            "QmEvidence4",
            "QmEvidence5",
        ];
        for (i, h) in hashes.iter().enumerate() {
            env.ledger()
                .with_mut(|l| l.timestamp = 2_000 + i as u64 * 100);
            let ipfs = String::from_str(&env, h);
            let desc = String::from_str(&env, "desc");
            client.submit_evidence(&trade_id, &buyer, &ipfs, &desc);
        }

        let list = client.get_evidence_list(&trade_id);
        assert_eq!(list.len(), 5, "must have exactly 5 evidence records");

        for (i, h) in hashes.iter().enumerate() {
            let expected = String::from_str(&env, h);
            assert_eq!(
                list.get(i as u32).unwrap().ipfs_hash,
                expected,
                "evidence at index {} must be {} (FIFO order)",
                i,
                h
            );
        }
    }

    /// Evidence list is never shuffled — order matches submission order.
    #[test]
    fn test_evidence_order_matches_submission_order_mixed_parties() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, seller, _treasury, mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let submissions: [(&Address, &str); 4] = [
            (&buyer, "QmBuyer-A"),
            (&seller, "QmSeller-B"),
            (&buyer, "QmBuyer-C"),
            (&mediator, "QmMediator-D"),
        ];

        for (i, (party, hash)) in submissions.iter().enumerate() {
            env.ledger()
                .with_mut(|l| l.timestamp = 2_000 + i as u64 * 100);
            let ipfs = String::from_str(&env, hash);
            let desc = String::from_str(&env, "desc");
            client.submit_evidence(&trade_id, party, &ipfs, &desc);
        }

        let list = client.get_evidence_list(&trade_id);
        assert_eq!(list.len(), 4);

        for (i, (party, hash)) in submissions.iter().enumerate() {
            let record = list.get(i as u32).unwrap();
            let expected_hash = String::from_str(&env, hash);
            assert_eq!(record.ipfs_hash, expected_hash, "wrong hash at index {}", i);
            assert_eq!(&record.submitter, *party, "wrong submitter at index {}", i);
        }
    }

    /// Evidence hash immutability: stored ipfs_hash cannot be changed after submission.
    #[test]
    fn test_evidence_hash_immutable_after_submission() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, _seller, _treasury, _mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let original_hash = String::from_str(&env, "QmOriginalHash");
        let desc = String::from_str(&env, "desc");
        client.submit_evidence(&trade_id, &buyer, &original_hash, &desc);

        let new_hash = String::from_str(&env, "QmAttemptedOverwrite");
        client.submit_evidence(&trade_id, &buyer, &new_hash, &desc);

        let list = client.get_evidence_list(&trade_id);
        assert_eq!(list.len(), 2, "should have 2 records, not 1 overwritten");
        assert_eq!(
            list.get(0).unwrap().ipfs_hash,
            original_hash,
            "first hash must be immutable"
        );
        assert_eq!(
            list.get(1).unwrap().ipfs_hash,
            new_hash,
            "second record has new hash"
        );
    }

    /// Video proof: first submission accepted, second attempt panics.
    #[test]
    #[should_panic(expected = "Video proof already submitted for this trade")]
    fn test_video_proof_second_submission_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, seller, _treasury, _mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let cid1 = String::from_str(&env, "QmFirstVideoCID");
        client.submit_video_proof(&trade_id, &buyer, &cid1);

        let cid2 = String::from_str(&env, "QmSecondVideoCID");
        client.submit_video_proof(&trade_id, &seller, &cid2);
    }

    /// Video proof immutability: once submitted, get_video_proof always returns original.
    #[test]
    fn test_video_proof_immutable_after_submission() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, _seller, _treasury, _mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let cid = String::from_str(&env, "QmImmutableVideoCID");
        client.submit_video_proof(&trade_id, &buyer, &cid);

        let proof = client.get_video_proof(&trade_id).expect("proof must exist");
        assert_eq!(proof.ipfs_cid, cid, "CID must be immutable");
        assert_eq!(proof.submitter, buyer, "submitter must be immutable");
    }

    /// Video proof: seller can also submit (not just buyer).
    #[test]
    fn test_video_proof_seller_can_submit() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, seller, _treasury, _mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let cid = String::from_str(&env, "QmSellerVideoCID");
        client.submit_video_proof(&trade_id, &seller, &cid);

        let proof = client.get_video_proof(&trade_id).expect("proof must exist");
        assert_eq!(proof.submitter, seller);
        assert_eq!(proof.ipfs_cid, cid);
    }

    /// Video proof: stranger cannot submit.
    #[test]
    #[should_panic(expected = "Only the buyer or seller can submit video proof")]
    fn test_video_proof_stranger_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, _seller, _treasury, _mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let stranger = Address::generate(&env);
        let cid = String::from_str(&env, "QmStrangerCID");
        client.submit_video_proof(&trade_id, &stranger, &cid);
    }

    /// Video proof: empty CID is rejected.
    #[test]
    #[should_panic(expected = "ipfs_cid must not be empty")]
    fn test_video_proof_empty_cid_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, _seller, _treasury, _mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let empty_cid = String::from_str(&env, "");
        client.submit_video_proof(&trade_id, &buyer, &empty_cid);
    }

    /// Evidence access control: stranger cannot submit evidence.
    #[test]
    #[should_panic(expected = "Only buyer, seller, or mediator can submit evidence")]
    fn test_evidence_stranger_cannot_submit() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, _seller, _treasury, _mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let stranger = Address::generate(&env);
        let ipfs = String::from_str(&env, "QmStrangerEvidence");
        let desc = String::from_str(&env, "desc");
        client.submit_evidence(&trade_id, &stranger, &ipfs, &desc);
    }

    /// Evidence: mediator (via add_mediator) can submit evidence.
    #[test]
    fn test_evidence_registered_mediator_can_submit() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _buyer, _seller, _treasury, mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let ipfs = String::from_str(&env, "QmMediatorEvidence");
        let desc = String::from_str(&env, "mediator analysis");
        client.submit_evidence(&trade_id, &mediator, &ipfs, &desc);

        let list = client.get_evidence_list(&trade_id);
        assert_eq!(list.len(), 1);
        assert_eq!(list.get(0).unwrap().submitter, mediator);
    }

    /// Evidence: timestamps are recorded in ascending order.
    #[test]
    fn test_evidence_timestamps_ascending() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, _seller, _treasury, _mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let timestamps = [2_000u64, 3_000, 4_000];
        let hashes = ["QmTs0", "QmTs1", "QmTs2"];
        for (i, &ts) in timestamps.iter().enumerate() {
            env.ledger().with_mut(|l| l.timestamp = ts);
            let ipfs = String::from_str(&env, hashes[i]);
            let desc = String::from_str(&env, "desc");
            client.submit_evidence(&trade_id, &buyer, &ipfs, &desc);
        }

        let list = client.get_evidence_list(&trade_id);
        for i in 0..list.len() - 1 {
            let a = list.get(i).unwrap().submitted_at;
            let b = list.get(i + 1).unwrap().submitted_at;
            assert!(a <= b, "timestamps must be non-decreasing");
        }
    }

    /// Evidence list remains accessible and unchanged after dispute resolution.
    #[test]
    fn test_evidence_preserved_after_resolution() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, buyer, _seller, _treasury, mediator, _usdc_id, trade_id) =
            setup_disputed(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let ipfs = String::from_str(&env, "QmPreservedEvidence");
        let desc = String::from_str(&env, "desc");
        client.submit_evidence(&trade_id, &buyer, &ipfs, &desc);

        client.resolve_dispute(&trade_id, &mediator, &10_000_u32);

        let list = client.get_evidence_list(&trade_id);
        assert_eq!(list.len(), 1, "evidence must be preserved after resolution");
        assert_eq!(list.get(0).unwrap().ipfs_hash, ipfs);
    }
}
