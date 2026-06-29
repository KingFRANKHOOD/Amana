extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeEvent};
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

        H { env, escrow, token, admin, buyer, seller, mediator, treasury }
    }

    fn c(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }

    fn tok(&self) -> MockTokenClient<'_> {
        MockTokenClient::new(&self.env, &self.token)
    }

    fn setup(&self) {
        let c = self.c();
        c.initialize(
            &self.admin,
            &self.token,
            &self.treasury,
            &100u32,
            &self.token,
        );
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

    fn event_types(&self, history: &soroban_sdk::Vec<TradeEvent>) -> std::vec::Vec<std::string::String> {
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
    assert_eq!(history.len(), 0, "non-existent trade should have empty history");
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
