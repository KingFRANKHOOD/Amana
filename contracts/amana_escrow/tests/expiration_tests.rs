/// Tests for SC-002: Trade Expiration / Lock-Time mechanism.
///
/// Verifies that:
/// - Trades can be created with an optional `expires_at` deadline.
/// - `claim_expiry_refund()` succeeds after the deadline passes and refunds the buyer.
/// - `claim_expiry_refund()` is rejected before the deadline.
/// - `claim_expiry_refund()` is rejected when no deadline is set.
/// - `claim_expiry_refund()` is rejected when the trade is not in `Funded` status.
/// - Only the buyer or seller can call `claim_expiry_refund()`.
/// - `create_trade()` rejects a deadline that is in the past.
extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use soroban_sdk::{
    Address, Env, contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
};

// ---------------------------------------------------------------------------
// Minimal mock token (same pattern as other test files)
// ---------------------------------------------------------------------------

#[contract]
pub struct MockToken;

#[contracttype]
#[derive(Clone)]
pub enum MTKey {
    Balance(Address),
}

#[contractimpl]
impl MockToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = MTKey::Balance(to);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&MTKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let from_key = MTKey::Balance(from);
        let to_key = MTKey::Balance(to);
        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        assert!(from_balance >= amount, "insufficient balance");
        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&to_key, &(to_balance + amount));
    }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

struct H {
    env: Env,
    escrow: Address,
    token: Address,
    admin: Address,
    buyer: Address,
    seller: Address,
    stranger: Address,
}

impl H {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| {
            l.timestamp = 1_700_000_000;
            l.sequence_number = 100;
        });

        let escrow = env.register(EscrowContract, ());
        let token = env.register(MockToken, ());
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let stranger = Address::generate(&env);

        H { env, escrow, token, admin, buyer, seller, stranger }
    }

    fn c(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }

    fn tok(&self) -> MockTokenClient<'_> {
        MockTokenClient::new(&self.env, &self.token)
    }

    fn init(&self) {
        self.c().initialize(
            &self.admin,
            &self.token,
            &self.admin,
            &0u32,
            &self.token,
        );
    }

    fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }

    fn advance_time(&self, seconds: u64) {
        self.env.ledger().with_mut(|l| {
            l.timestamp += seconds;
        });
    }

    /// Create a funded trade with the given deadline (seconds from now).
    fn funded_trade_with_deadline(&self, amount: i128, deadline_offset: u64) -> u64 {
        let deadline = self.now() + deadline_offset;
        self.tok().mint(&self.buyer, &amount);
        let trade_id = self.c().create_trade(
            &self.buyer,
            &self.seller,
            &amount,
            &5000u32,
            &5000u32,
            &Some(deadline),
        );
        self.c().deposit(&trade_id);
        trade_id
    }

    /// Create a funded trade with no deadline.
    fn funded_trade_no_deadline(&self, amount: i128) -> u64 {
        self.tok().mint(&self.buyer, &amount);
        let trade_id = self.c().create_trade(
            &self.buyer,
            &self.seller,
            &amount,
            &5000u32,
            &5000u32,
            &None,
        );
        self.c().deposit(&trade_id);
        trade_id
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Happy path: buyer claims refund after deadline passes.
#[test]
fn test_expiry_refund_buyer_after_deadline() {
    let h = H::new();
    h.init();

    let amount = 1_000_000i128;
    let trade_id = h.funded_trade_with_deadline(amount, 3600); // 1 hour deadline

    // Advance past the deadline
    h.advance_time(3601);

    let buyer_balance_before = h.tok().balance(&h.buyer);
    h.c().claim_expiry_refund(&trade_id, &h.buyer);
    let buyer_balance_after = h.tok().balance(&h.buyer);

    assert_eq!(
        buyer_balance_after - buyer_balance_before,
        amount,
        "buyer should receive full refund"
    );

    let trade = h.c().get_trade(&trade_id);
    assert!(
        matches!(trade.status, TradeStatus::Cancelled),
        "trade must be Cancelled after expiry refund"
    );
}

/// Happy path: seller can also trigger the expiry refund (funds still go to buyer).
#[test]
fn test_expiry_refund_seller_after_deadline() {
    let h = H::new();
    h.init();

    let amount = 500_000i128;
    let trade_id = h.funded_trade_with_deadline(amount, 7200);

    h.advance_time(7201);

    let buyer_balance_before = h.tok().balance(&h.buyer);
    h.c().claim_expiry_refund(&trade_id, &h.seller);
    let buyer_balance_after = h.tok().balance(&h.buyer);

    assert_eq!(
        buyer_balance_after - buyer_balance_before,
        amount,
        "buyer should receive full refund even when seller triggers expiry"
    );

    let trade = h.c().get_trade(&trade_id);
    assert!(matches!(trade.status, TradeStatus::Cancelled));
}

/// Rejection: claim before deadline should panic.
#[test]
#[should_panic(expected = "Trade has not yet expired")]
fn test_expiry_refund_rejected_before_deadline() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    // Only advance 30 minutes — deadline not reached
    h.advance_time(1800);

    h.c().claim_expiry_refund(&trade_id, &h.buyer);
}

/// Rejection: trade with no deadline cannot be expired.
#[test]
#[should_panic(expected = "Trade has no expiry deadline")]
fn test_expiry_refund_rejected_no_deadline() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_no_deadline(100_000);

    h.advance_time(999_999);

    h.c().claim_expiry_refund(&trade_id, &h.buyer);
}

/// Rejection: stranger cannot claim expiry refund.
#[test]
#[should_panic(expected = "Only the buyer or seller can claim an expiry refund")]
fn test_expiry_refund_rejected_stranger() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);
    h.advance_time(3601);

    h.c().claim_expiry_refund(&trade_id, &h.stranger);
}

/// Rejection: cannot claim expiry on a Delivered trade.
#[test]
#[should_panic(expected = "Trade must be in Funded status to claim expiry refund")]
fn test_expiry_refund_rejected_delivered_status() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);
    h.c().confirm_delivery(&trade_id);

    h.advance_time(3601);

    h.c().claim_expiry_refund(&trade_id, &h.buyer);
}

/// Rejection: cannot claim expiry on a Disputed trade.
#[test]
#[should_panic(expected = "Trade must be in Funded status to claim expiry refund")]
fn test_expiry_refund_rejected_disputed_status() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    use soroban_sdk::String as SorobanString;
    h.c().initiate_dispute(
        &trade_id,
        &h.buyer,
        &SorobanString::from_str(&h.env, "QmDisputeReason"),
    );

    h.advance_time(3601);

    h.c().claim_expiry_refund(&trade_id, &h.buyer);
}

/// Rejection: create_trade with a past deadline should panic.
#[test]
#[should_panic(expected = "expires_at must be in the future")]
fn test_create_trade_rejects_past_deadline() {
    let h = H::new();
    h.init();

    let past_deadline = h.now() - 1; // one second in the past
    h.tok().mint(&h.buyer, &100_000i128);
    h.c().create_trade(
        &h.buyer,
        &h.seller,
        &100_000i128,
        &5000u32,
        &5000u32,
        &Some(past_deadline),
    );
}

/// Verify trade struct stores the deadline correctly.
#[test]
fn test_trade_stores_expires_at() {
    let h = H::new();
    h.init();

    let deadline = h.now() + 86_400; // 24 hours
    h.tok().mint(&h.buyer, &100_000i128);
    let trade_id = h.c().create_trade(
        &h.buyer,
        &h.seller,
        &100_000i128,
        &5000u32,
        &5000u32,
        &Some(deadline),
    );

    let trade = h.c().get_trade(&trade_id);
    assert_eq!(trade.expires_at, Some(deadline), "expires_at must be stored on trade");
}

/// Verify trade with no deadline stores None.
#[test]
fn test_trade_no_deadline_stores_none() {
    let h = H::new();
    h.init();

    h.tok().mint(&h.buyer, &100_000i128);
    let trade_id = h.c().create_trade(
        &h.buyer,
        &h.seller,
        &100_000i128,
        &5000u32,
        &5000u32,
        &None,
    );

    let trade = h.c().get_trade(&trade_id);
    assert_eq!(trade.expires_at, None, "expires_at must be None when not set");
}

/// Verify expiry refund at exactly the deadline timestamp succeeds.
#[test]
fn test_expiry_refund_at_exact_deadline() {
    let h = H::new();
    h.init();

    let amount = 200_000i128;
    let offset = 3600u64;
    let trade_id = h.funded_trade_with_deadline(amount, offset);

    // Advance to exactly the deadline
    h.advance_time(offset);

    let buyer_before = h.tok().balance(&h.buyer);
    h.c().claim_expiry_refund(&trade_id, &h.buyer);
    let buyer_after = h.tok().balance(&h.buyer);

    assert_eq!(buyer_after - buyer_before, amount);
}
