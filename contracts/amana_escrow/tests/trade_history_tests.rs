extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, MAX_HISTORY_LEN, TradeEvent};
use soroban_sdk::{
    Address, Env, String as SorobanString, contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
};

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

struct H {
    env: Env,
    escrow: Address,
    token: Address,
    admin: Address,
    buyer: Address,
    seller: Address,
    mediator: Address,
    treasury: Address,
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
        let mediator = Address::generate(&env);
        let treasury = Address::generate(&env);

        H {
            env,
            escrow,
            token,
            admin,
            buyer,
            seller,
            mediator,
            treasury,
        }
    }

    fn c(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }

    fn tok(&self) -> MockTokenClient<'_> {
        MockTokenClient::new(&self.env, &self.token)
    }

    fn setup(&self) {
        let c = self.c();
        c.initialize(&soroban_sdk::Vec::from_array(&self.env, [self.admin.clone()]), &1_u32, &self.token, &self.treasury, &100u32, &self.token);
        c.set_mediator(&self.mediator);
    }

    fn create_trade(&self) -> u64 {
        let c = self.c();
        c.create_trade(
            &self.buyer,
            &self.seller,
            &1_000_i128,
            &5_000u32,
            &5_000u32,
            &None,
        )
    }

    fn fund_trade(&self, trade_id: u64) {
        self.tok().mint(&self.buyer, &1_000);
        self.c().deposit(&trade_id);
    }

    fn event_types(
        &self,
        history: &soroban_sdk::Vec<TradeEvent>,
    ) -> std::vec::Vec<std::string::String> {
        let mut types = std::vec::Vec::new();
        for i in 0..history.len() {
            let ev = history.get(i).unwrap();
            types.push(ev.event_type.to_string());
        }
        types
    }
}

#[test]
fn test_history_empty_for_nonexistent_trade() {
    let h = H::new();
    h.setup();
    let history = h.c().get_trade_history(&9999u64);
    assert_eq!(
        history.len(),
        0,
        "non-existent trade should have empty history"
    );
}

#[test]
fn test_history_records_created_event() {
    let h = H::new();
    h.setup();
    let trade_id = h.create_trade();

    let history = h.c().get_trade_history(&trade_id);
    assert_eq!(history.len(), 1);
    let ev = history.get(0).unwrap();
    assert_eq!(ev.event_type, SorobanString::from_str(&h.env, "created"));
}

#[test]
fn test_history_records_full_happy_path() {
    let h = H::new();
    h.setup();
    let trade_id = h.create_trade();
    h.fund_trade(trade_id);
    h.c().confirm_delivery(&trade_id);
    h.c().release_funds(&trade_id, &h.buyer);

    let history = h.c().get_trade_history(&trade_id);
    assert_eq!(history.len(), 4);

    let types = h.event_types(&history);
    assert_eq!(types[0], "created");
    assert_eq!(types[1], "funded");
    assert_eq!(types[2], "delivered");
    assert_eq!(types[3], "released");
}

#[test]
fn test_history_records_dispute_and_resolution() {
    let h = H::new();
    h.setup();
    let trade_id = h.create_trade();
    h.fund_trade(trade_id);

    let reason = SorobanString::from_str(&h.env, "QmTestHash");
    h.c().initiate_dispute(&trade_id, &h.buyer, &reason);
    h.c().resolve_dispute(&trade_id, &h.mediator, &7_000u32);

    let history = h.c().get_trade_history(&trade_id);
    assert_eq!(history.len(), 4);

    let types = h.event_types(&history);
    assert_eq!(types[0], "created");
    assert_eq!(types[1], "funded");
    assert_eq!(types[2], "disputed");
    assert_eq!(types[3], "resolved");
}

#[test]
fn test_history_records_cancellation() {
    let h = H::new();
    h.setup();
    let trade_id = h.create_trade();
    h.c().cancel_trade(&trade_id, &h.buyer);

    let history = h.c().get_trade_history(&trade_id);
    assert_eq!(history.len(), 2);

    let types = h.event_types(&history);
    assert_eq!(types[0], "created");
    assert_eq!(types[1], "cancelled");
}

// ---------------------------------------------------------------------------
// History length cap — issue #1078
// ---------------------------------------------------------------------------

/// Helper that creates and funds a trade with a deadline, so that
/// `extend_deadline` can be called repeatedly to drive the history length.
fn setup_trade_with_deadline(h: &H) -> u64 {
    let c = h.c();
    let now = h.env.ledger().timestamp();
    let initial_deadline = now + 10_000_000;
    let trade_id = c.create_trade(
        &h.buyer,
        &h.seller,
        &1_000_i128,
        &5_000u32,
        &5_000u32,
        &Some(initial_deadline),
    );
    h.tok().mint(&h.buyer, &1_000);
    c.deposit(&trade_id);
    trade_id
}

/// Extend the deadline `count` times, each time shifting it 1 second further.
/// This drives `count` additional "deadline_extended" history entries.
fn extend_deadline_n_times(h: &H, trade_id: u64, count: u32) {
    let c = h.c();
    let base_future = h.env.ledger().timestamp() + 10_000_000;
    for i in 0..count {
        let new_deadline = base_future + (i + 1) as u64;
        c.extend_deadline(&trade_id, &new_deadline);
    }
}

/// The history vector must never grow beyond MAX_HISTORY_LEN entries.
/// After filling to the cap, each new append evicts the oldest entry
/// so the total remains at MAX_HISTORY_LEN (sliding window / circular buffer).
#[test]
fn test_history_cap_enforced_at_max_history_len() {
    let h = H::new();
    h.setup();
    let trade_id = setup_trade_with_deadline(&h);

    // At this point: 2 events (created + funded).
    // Extend deadline (MAX_HISTORY_LEN - 2) more times to fill the buffer exactly.
    let fills = amana_escrow::MAX_HISTORY_LEN - 2;
    extend_deadline_n_times(&h, trade_id, fills);

    let history = h.c().get_trade_history(&trade_id);
    assert_eq!(
        history.len(),
        amana_escrow::MAX_HISTORY_LEN,
        "history should be exactly MAX_HISTORY_LEN after filling"
    );

    // The first entry should still be "created" — nothing was evicted yet.
    let first = history.get(0).unwrap();
    assert_eq!(
        first.event_type,
        soroban_sdk::String::from_str(&h.env, "created"),
        "oldest entry should still be 'created' when cap is just reached"
    );
}

/// Once the cap is reached, pushing one more entry must evict the oldest,
/// keeping the total at MAX_HISTORY_LEN and sliding the window forward.
#[test]
fn test_history_cap_evicts_oldest_entry_on_overflow() {
    let h = H::new();
    h.setup();
    let trade_id = setup_trade_with_deadline(&h);

    // Fill to MAX_HISTORY_LEN exactly (created + funded + fills).
    let fills = amana_escrow::MAX_HISTORY_LEN - 2;
    extend_deadline_n_times(&h, trade_id, fills);

    // One more extension should evict the oldest entry ("created").
    let overflow_deadline = h.env.ledger().timestamp() + 20_000_000;
    h.c().extend_deadline(&trade_id, &overflow_deadline);

    let history = h.c().get_trade_history(&trade_id);

    // Length must remain capped — no growth beyond MAX_HISTORY_LEN.
    assert_eq!(
        history.len(),
        amana_escrow::MAX_HISTORY_LEN,
        "history must not exceed MAX_HISTORY_LEN after overflow"
    );

    // The oldest "created" event was evicted; the new first entry should be "funded".
    let new_first = history.get(0).unwrap();
    assert_eq!(
        new_first.event_type,
        soroban_sdk::String::from_str(&h.env, "funded"),
        "oldest 'created' event should be evicted; 'funded' is now the first entry"
    );

    // The most recent entry should be the overflow "deadline_extended".
    let last = history.get(amana_escrow::MAX_HISTORY_LEN - 1).unwrap();
    assert_eq!(
        last.event_type,
        soroban_sdk::String::from_str(&h.env, "deadline_extended"),
        "most recent entry should be the overflow deadline_extended"
    );
}

/// Continuous overflow: pushing many entries beyond the cap should keep
/// the history window sliding and the length always bounded at MAX_HISTORY_LEN.
#[test]
fn test_history_cap_remains_bounded_after_many_overflows() {
    let h = H::new();
    h.setup();
    let trade_id = setup_trade_with_deadline(&h);

    // Push 2 * MAX_HISTORY_LEN total events to stress the sliding window.
    let total_extra = amana_escrow::MAX_HISTORY_LEN * 2 - 2;
    extend_deadline_n_times(&h, trade_id, total_extra);

    let history = h.c().get_trade_history(&trade_id);
    assert_eq!(
        history.len(),
        amana_escrow::MAX_HISTORY_LEN,
        "history must remain bounded at MAX_HISTORY_LEN regardless of total events written"
    );

    // Every retained entry should be "deadline_extended" since all earlier
    // events have long since been evicted by this point.
    for i in 0..amana_escrow::MAX_HISTORY_LEN {
        let ev = history.get(i).unwrap();
        assert_eq!(
            ev.event_type,
            soroban_sdk::String::from_str(&h.env, "deadline_extended"),
            "entry at index {i} should be deadline_extended"
        );
    }
}
