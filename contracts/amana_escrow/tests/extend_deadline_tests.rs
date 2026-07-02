/// Tests for extend_deadline — mutual agreement to extend delivery deadline.
///
/// Verifies that:
/// - Both parties can extend a deadline on a funded trade.
/// - A single-party call (buyer-only or seller-only) is rejected.
/// - Extending a deadline that has already passed is rejected.
/// - Extending with a past new deadline is rejected.
/// - A trade without a deadline cannot be extended.
/// - The trade's expires_at field is updated and a DeadlineExtendedEvent is emitted.
extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient};
use soroban_sdk::{
    Address, Env, IntoVal, contract, contractimpl, contracttype,
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    xdr::{ContractEventBody, ScVal},
};

// ---------------------------------------------------------------------------
// Minimal mock token (same pattern as expiration_tests.rs)
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
    #[allow(dead_code)]
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

        H {
            env,
            escrow,
            token,
            admin,
            buyer,
            seller,
            stranger,
        }
    }

    fn c(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }

    fn tok(&self) -> MockTokenClient<'_> {
        MockTokenClient::new(&self.env, &self.token)
    }

    fn init(&self) {
        self.c()
            .initialize(&self.admin, &self.token, &self.admin, &0u32, &self.token);
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

/// Return the topics of the last emitted event as a Vec of ScVal for comparison.
fn last_event_topics(env: &Env) -> Vec<ScVal> {
    let all = env.events().all();
    let events = all.events();
    assert!(!events.is_empty(), "no events emitted");
    let last = events.last().unwrap();
    match &last.body {
        ContractEventBody::V0(v0) => v0.topics.to_vec(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Happy path: both parties can mutually extend the deadline.
#[test]
fn test_mutual_extension_succeeds() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600); // 1 hour deadline
    let original_deadline = h.c().get_trade(&trade_id).expires_at.unwrap();
    let new_deadline = original_deadline + 3600; // extend by another hour

    h.c().extend_deadline(&trade_id, &new_deadline);

    let trade = h.c().get_trade(&trade_id);
    assert_eq!(trade.expires_at, Some(new_deadline));
}

/// Happy path: confirm DeadlineExtendedEvent is emitted.
#[test]
fn test_extend_deadline_emits_event() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(1_000_000, 3600);
    let original = h.c().get_trade(&trade_id).expires_at.unwrap();
    let new_deadline = original + 7200;

    h.c().extend_deadline(&trade_id, &new_deadline);

    let topics = last_event_topics(&h.env);
    let topic_str = std::format!("{:?}", topics.first().unwrap());
    assert!(
        topic_str.contains("DEDEXT"),
        "expected DeadlineExtended event, got: {topic_str}"
    );
}

/// Rejection: trade not in Funded status (still Created).
#[test]
#[should_panic(expected = "Trade must be Funded to extend deadline")]
fn test_extend_deadline_fails_if_not_funded() {
    let h = H::new();
    h.init();

    let deadline = h.now() + 3600;
    h.tok().mint(&h.buyer, &100_000);
    let trade_id = h.c().create_trade(
        &h.buyer,
        &h.seller,
        &100_000,
        &5000u32,
        &5000u32,
        &Some(deadline),
    );
    // Trade is Created, not Funded

    let new_deadline = deadline + 3600;
    h.c().extend_deadline(&trade_id, &new_deadline);
}

/// Rejection: cannot extend a deadline that has already passed.
#[test]
#[should_panic(expected = "Cannot extend a deadline that has already passed")]
fn test_extend_deadline_fails_if_past_deadline() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    // Advance past the deadline
    h.advance_time(3601);

    let new_deadline = h.now() + 3600;
    h.c().extend_deadline(&trade_id, &new_deadline);
}

/// Rejection: new deadline must be in the future.
#[test]
#[should_panic(expected = "New deadline must be in the future")]
fn test_extend_deadline_fails_if_new_deadline_in_past() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    let past = h.now() - 1;
    h.c().extend_deadline(&trade_id, &past);
}

/// Rejection: trade has no deadline set.
#[test]
#[should_panic(expected = "Trade has no deadline to extend")]
fn test_extend_deadline_fails_if_no_deadline() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_no_deadline(100_000);

    let new_deadline = h.now() + 3600;
    h.c().extend_deadline(&trade_id, &new_deadline);
}

/// Rejection: only buyer signs (seller did not authorize).
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_extend_deadline_fails_if_only_buyer_signs() {
    let h = H::new();
    h.init();

    let deadline = h.now() + 3600;
    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    let new_dl = deadline + 7200;
    // Override auths to only include buyer — seller auth is missing.
    h.c()
        .mock_auths(&[MockAuth {
            address: &h.buyer,
            invoke: &MockAuthInvoke {
                contract: &h.escrow,
                fn_name: "extend_deadline",
                args: (&trade_id, &new_dl).into_val(&h.env),
                sub_invokes: &[],
            },
        }])
        .extend_deadline(&trade_id, &new_dl);
}

/// Rejection: only seller signs (buyer did not authorize).
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_extend_deadline_fails_if_only_seller_signs() {
    let h = H::new();
    h.init();

    let deadline = h.now() + 3600;
    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    let new_dl = deadline + 7200;
    // Override auths to only include seller — buyer auth is missing.
    h.c()
        .mock_auths(&[MockAuth {
            address: &h.seller,
            invoke: &MockAuthInvoke {
                contract: &h.escrow,
                fn_name: "extend_deadline",
                args: (&trade_id, &new_dl).into_val(&h.env),
                sub_invokes: &[],
            },
        }])
        .extend_deadline(&trade_id, &new_dl);
}
