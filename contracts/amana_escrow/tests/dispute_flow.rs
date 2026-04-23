extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use soroban_sdk::{
    Address, Env, String as SorobanString, contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
};
use std::cell::RefCell;
use std::collections::HashMap;

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

#[derive(Clone, Debug, PartialEq)]
enum DbStatus {
    Funded,
    Disputed,
    #[allow(dead_code)]
    Completed,
}

#[derive(Clone, Debug)]
struct DbTrade {
    trade_id: u64,
    status: DbStatus,
    evidence_count: usize,
}

thread_local! {
    static MOCK_DB: RefCell<HashMap<u64, DbTrade>> = RefCell::new(HashMap::new());
}

fn db_upsert(trade: DbTrade) {
    MOCK_DB.with(|db| {
        db.borrow_mut().insert(trade.trade_id, trade);
    });
}

fn db_get(id: u64) -> Option<DbTrade> {
    MOCK_DB.with(|db| db.borrow().get(&id).cloned())
}

fn db_reset() {
    MOCK_DB.with(|db| db.borrow_mut().clear());
}

struct H {
    env: Env,
    escrow: Address,
    token: Address,
    admin: Address,
    buyer: Address,
    seller: Address,
    mediator: Address,
    unrelated: Address,
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
        let unrelated = Address::generate(&env);

        H {
            env,
            escrow,
            token,
            admin,
            buyer,
            seller,
            mediator,
            unrelated,
        }
    }

    fn c(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }

    fn tok(&self) -> MockTokenClient<'_> {
        MockTokenClient::new(&self.env, &self.token)
    }

    fn funded_trade(&self, amount: i128) -> u64 {
        self.c()
            .initialize(&self.admin, &self.token, &self.admin, &0u32);
        self.c().set_mediator(&self.mediator);
        self.tok().mint(&self.buyer, &amount);
        let trade_id =
            self.c()
                .create_trade(&self.buyer, &self.seller, &amount, &5000u32, &5000u32);
        self.c().deposit(&trade_id);
        db_upsert(DbTrade {
            trade_id,
            status: DbStatus::Funded,
            evidence_count: 0,
        });
        trade_id
    }

    fn cleanup(&self) {
        db_reset();
    }
}

#[test]
fn test_evidence_stores_cid_and_records_sender() {
    let h = H::new();
    let trade_id = h.funded_trade(100_000_000);

    h.c().initiate_dispute(
        &trade_id,
        &h.buyer,
        &SorobanString::from_str(&h.env, "QmBuyerEvidenceDispute"),
    );
    db_upsert(DbTrade {
        trade_id,
        status: DbStatus::Disputed,
        evidence_count: 0,
    });

    let cid = SorobanString::from_str(&h.env, "QmTest123456789abcdefghijklmnopqrstuvwxyz");
    let desc = SorobanString::from_str(&h.env, "Buyer payment proof");
    h.c().submit_evidence(&trade_id, &h.buyer, &cid, &desc);

    let list = h.c().get_evidence_list(&trade_id);
    assert_eq!(list.len(), 1);
    assert_eq!(list.get(0).unwrap().submitter, h.buyer);

    let legacy = h.c().get_evidence(&trade_id, &h.buyer);
    assert!(legacy.is_some());

    if let Some(record) = db_get(trade_id) {
        assert_eq!(record.status, DbStatus::Disputed);
        assert_eq!(record.evidence_count, 0);
    }

    h.cleanup();
}

#[test]
#[should_panic(expected = "Only buyer, seller, or mediator can submit evidence")]
fn test_evidence_rejects_unrelated_user() {
    let h = H::new();
    let trade_id = h.funded_trade(100_000_000);

    h.c().initiate_dispute(
        &trade_id,
        &h.buyer,
        &SorobanString::from_str(&h.env, "QmBuyerEvidenceDispute"),
    );

    h.c().submit_evidence(
        &trade_id,
        &h.unrelated,
        &SorobanString::from_str(&h.env, "QmBadEvidence"),
        &SorobanString::from_str(&h.env, "Unauthorized"),
    );
}

#[test]
fn test_multiple_evidence_entries_accumulate() {
    let h = H::new();
    let trade_id = h.funded_trade(100_000_000);

    h.c().initiate_dispute(
        &trade_id,
        &h.buyer,
        &SorobanString::from_str(&h.env, "QmMultiEvidenceDispute"),
    );

    h.c().submit_evidence(
        &trade_id,
        &h.buyer,
        &SorobanString::from_str(&h.env, "QmBuyerEvidence1"),
        &SorobanString::from_str(&h.env, "Buyer proof"),
    );
    h.c().submit_evidence(
        &trade_id,
        &h.seller,
        &SorobanString::from_str(&h.env, "QmSellerEvidence1"),
        &SorobanString::from_str(&h.env, "Seller proof"),
    );
    h.c().submit_evidence(
        &trade_id,
        &h.mediator,
        &SorobanString::from_str(&h.env, "QmMediatorEvidence1"),
        &SorobanString::from_str(&h.env, "Mediator analysis"),
    );

    let list = h.c().get_evidence_list(&trade_id);
    assert_eq!(list.len(), 3);
    assert_eq!(list.get(0).unwrap().submitter, h.buyer);
    assert_eq!(list.get(1).unwrap().submitter, h.seller);
    assert_eq!(list.get(2).unwrap().submitter, h.mediator);
}

#[test]
fn test_dispute_resolution_moves_trade_to_completed() {
    let h = H::new();
    let trade_id = h.funded_trade(100_000_000);

    h.c().initiate_dispute(
        &trade_id,
        &h.buyer,
        &SorobanString::from_str(&h.env, "QmResolutionDispute"),
    );
    h.c().submit_evidence(
        &trade_id,
        &h.buyer,
        &SorobanString::from_str(&h.env, "QmBuyerProof"),
        &SorobanString::from_str(&h.env, "Buyer proof"),
    );
    h.c().resolve_dispute(&trade_id, &h.mediator, &3_000u32);

    assert!(matches!(
        h.c().get_trade(&trade_id).status,
        TradeStatus::Completed
    ));

    let tok = h.tok();
    let total = tok.balance(&h.buyer)
        + tok.balance(&h.seller)
        + tok.balance(&h.admin)
        + tok.balance(&h.escrow);
    assert_eq!(total, 100_000_000);

    h.cleanup();
}
