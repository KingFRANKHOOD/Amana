extern crate std;
use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use soroban_sdk::testutils::Events;
use soroban_sdk::{
    Address, Env, String as SorobanString, Symbol, contract, contractimpl, contracttype,
    symbol_short,
    testutils::{Address as _, Ledger},
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::string::String;
use std::vec::Vec;

const STATIC_CID: &str = "QmTest123456789abcdefghijklmnopqrstuvwxyz";
thread_local! {
    static MOCK_IPFS: RefCell<HashMap<u64, String>> = RefCell::new(HashMap::new());
}
fn ipfs_upload(_d: &[u8], id: u64) -> String {
    MOCK_IPFS.with(|m| m.borrow_mut().insert(id, STATIC_CID.to_string()));
    STATIC_CID.to_string()
}
fn ipfs_get(id: u64) -> Option<String> {
    MOCK_IPFS.with(|m| m.borrow().get(&id).cloned())
}
fn ipfs_reset() {
    MOCK_IPFS.with(|m| m.borrow_mut().clear());
}

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
        let k = MTKey::Balance(to);
        let c: i128 = env.storage().persistent().get(&k).unwrap_or(0);
        env.storage().persistent().set(&k, &(c + amount));
    }
    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&MTKey::Balance(id))
            .unwrap_or(0)
    }
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let fk = MTKey::Balance(from);
        let tk = MTKey::Balance(to);
        let fb: i128 = env.storage().persistent().get(&fk).unwrap_or(0);
        assert!(fb >= amount, "insufficient balance");
        let tb: i128 = env.storage().persistent().get(&tk).unwrap_or(0);
        env.storage().persistent().set(&fk, &(fb - amount));
        env.storage().persistent().set(&tk, &(tb + amount));
    }
}

#[derive(Clone, Debug, PartialEq)]
enum DbStatus {
    Funded,
    Disputed,
    Cancelled,
}
#[derive(Clone, Debug)]
struct DbTrade {
    trade_id: u64,
    amount_usdc: i128,
    status: DbStatus,
    evidence_cid: Option<String>,
}
thread_local! { static MOCK_DB: RefCell<HashMap<u64, DbTrade>> = RefCell::new(HashMap::new()); }
fn db_upsert(t: DbTrade) {
    MOCK_DB.with(|db| {
        db.borrow_mut().insert(t.trade_id, t);
    });
}
fn db_get(id: u64) -> Option<DbTrade> {
    MOCK_DB.with(|db| db.borrow().get(&id).cloned())
}
fn db_reset() {
    MOCK_DB.with(|db| db.borrow_mut().clear());
}
fn backend_on_dispute(id: u64) {
    MOCK_DB.with(|db| {
        if let Some(t) = db.borrow_mut().get_mut(&id) {
            t.status = DbStatus::Disputed;
        }
    });
}
fn backend_on_resolved(id: u64) {
    MOCK_DB.with(|db| {
        if let Some(t) = db.borrow_mut().get_mut(&id) {
            t.status = DbStatus::Cancelled;
        }
    });
}
fn backend_store_cid(id: u64, cid: &str) {
    MOCK_DB.with(|db| {
        if let Some(t) = db.borrow_mut().get_mut(&id) {
            t.evidence_cid = Some(cid.to_string());
        }
    });
}

struct H {
    env: Env,
    escrow: Address,
    token: Address,
    admin: Address,
    buyer: Address,
    seller: Address,
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
        let unrelated = Address::generate(&env);
        H {
            env,
            escrow,
            token,
            admin,
            buyer,
            seller,
            unrelated,
        }
    }
    fn c(&self) -> EscrowContractClient {
        EscrowContractClient::new(&self.env, &self.escrow)
    }
    fn tok(&self) -> MockTokenClient {
        MockTokenClient::new(&self.env, &self.token)
    }
    fn funded_trade(&self, amount: i128) -> u64 {
        self.c().initialize(&self.admin, &self.token, &0u32);
        self.tok().mint(&self.escrow, &amount);
        let id = self.c().create_trade(&self.buyer, &self.seller, &amount);
        self.c().mark_funded(&id);
        db_upsert(DbTrade {
            trade_id: id,
            amount_usdc: amount,
            status: DbStatus::Funded,
            evidence_cid: None,
        });
        id
    }
    fn cleanup(&self) {
        ipfs_reset();
        db_reset();
    }
}
fn has_event(env: &Env, sym: Symbol) -> bool {
    env.events().all().iter().any(|e| {
        e.0.len() >= 1 && {
            let s: Symbol = e.0.get(0).unwrap();
            s == sym
        }
    })
}

// â”€â”€ Test 1: Evidence happy path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
fn test_evidence_stores_cid_on_chain_and_in_db() {
    let h = H::new();
    let id = h.funded_trade(100_000_000);
    let dummy: Vec<u8> = vec![0u8; 5 * 1024 * 1024];
    let cid = ipfs_upload(&dummy, id);
    assert_eq!(cid, STATIC_CID);
    let scid = SorobanString::from_str(&h.env, &cid);
    h.c().submit_evidence(&id, &scid, &h.buyer);
    backend_store_cid(id, &cid);
    assert_eq!(
        db_get(id).unwrap().evidence_cid.as_deref(),
        Some(STATIC_CID)
    );
    let ev = h.c().get_evidence(&id);
    assert_eq!(ev.cid, scid);
    assert_eq!(ev.submitter, h.buyer);
    h.cleanup();
}

// â”€â”€ Test 2: Evidence 403 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
#[should_panic(expected = "Unauthorized: only buyer or seller can submit evidence")]
fn test_evidence_rejects_unrelated_user() {
    let h = H::new();
    let id = h.funded_trade(100_000_000);
    h.c().submit_evidence(
        &id,
        &SorobanString::from_str(&h.env, STATIC_CID),
        &h.unrelated,
    );
    h.cleanup();
}

// â”€â”€ Test 3: Evidence immutability (405) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
#[should_panic(expected = "EvidenceImmutable: evidence already submitted")]
fn test_evidence_overwrite_rejected() {
    let h = H::new();
    let id = h.funded_trade(100_000_000);
    let cid = SorobanString::from_str(&h.env, STATIC_CID);
    h.c().submit_evidence(&id, &cid, &h.buyer);
    h.c().submit_evidence(
        &id,
        &SorobanString::from_str(&h.env, "QmDifferentCID"),
        &h.buyer,
    );
    h.cleanup();
}

// â”€â”€ Test 4: Dispute initiation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
fn test_dispute_initiation_event_and_db_sync() {
    let h = H::new();
    let id = h.funded_trade(100_000_000);
    h.c().initiate_dispute(&id, &h.buyer);
    assert_eq!(h.c().get_trade(&id).status, TradeStatus::Disputed);
    assert!(
        has_event(&h.env, symbol_short!("TRDDISP")),
        "TradeDisputed event missing"
    );
    backend_on_dispute(id);
    assert_eq!(db_get(id).unwrap().status, DbStatus::Disputed);
    h.cleanup();
}

// â”€â”€ Test 5: State lock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
#[should_panic(expected = "cannot deliver while trade is disputed")]
fn test_deliver_item_blocked_during_dispute() {
    let h = H::new();
    let id = h.funded_trade(100_000_000);
    h.c().initiate_dispute(&id, &h.buyer);
    h.c().deliver_item(&id);
    h.cleanup();
}

// â”€â”€ Test 6: Mediator sees streaming URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
fn test_mediator_sees_streaming_url() {
    let h = H::new();
    let id = h.funded_trade(100_000_000);
    let cid = ipfs_upload(&[0u8; 1024], id);
    h.c()
        .submit_evidence(&id, &SorobanString::from_str(&h.env, &cid), &h.buyer);
    backend_store_cid(id, &cid);
    h.c().initiate_dispute(&id, &h.buyer);
    backend_on_dispute(id);
    let db = db_get(id).unwrap();
    assert_eq!(db.status, DbStatus::Disputed);
    let url = std::format!("https://ipfs.io/ipfs/{}", db.evidence_cid.unwrap());
    assert!(url.contains(STATIC_CID));
    assert!(url.starts_with("https://ipfs.io/ipfs/"));
    assert_eq!(ipfs_get(id).as_deref(), Some(STATIC_CID));
    h.cleanup();
}

// â”€â”€ Test 7: 30/70 split â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
fn test_resolve_30_70_split_exact_balances() {
    let h = H::new();
    let amount: i128 = 100_000_000;
    let id = h.funded_trade(amount);
    h.c().initiate_dispute(&id, &h.buyer);
    h.c().resolve_dispute(&id, &3_000u32);
    assert!(
        has_event(&h.env, symbol_short!("TRDRES")),
        "TradeResolved event missing"
    );
    let expected_seller: i128 = amount * 3_000 / 10_000;
    let expected_buyer: i128 = amount - expected_seller;
    assert_eq!(
        h.tok().balance(&h.seller),
        expected_seller,
        "seller must receive 30 USDC"
    );
    assert_eq!(
        h.tok().balance(&h.buyer),
        expected_buyer,
        "buyer must receive 70 USDC"
    );
    assert_eq!(h.tok().balance(&h.escrow), 0, "escrow must be drained");
    assert_eq!(h.c().get_trade(&id).status, TradeStatus::Cancelled);
    backend_on_resolved(id);
    assert_eq!(db_get(id).unwrap().status, DbStatus::Cancelled);
    h.cleanup();
}

// â”€â”€ Test 8: 100% seller â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
fn test_resolve_full_seller_payout() {
    let h = H::new();
    let amount: i128 = 100_000_000;
    let id = h.funded_trade(amount);
    h.c().initiate_dispute(&id, &h.buyer);
    h.c().resolve_dispute(&id, &10_000u32);
    assert_eq!(h.tok().balance(&h.seller), amount);
    assert_eq!(h.tok().balance(&h.buyer), 0);
    assert_eq!(h.tok().balance(&h.escrow), 0);
    h.cleanup();
}

// â”€â”€ Test 9: 100% buyer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
fn test_resolve_full_buyer_refund() {
    let h = H::new();
    let amount: i128 = 100_000_000;
    let id = h.funded_trade(amount);
    h.c().initiate_dispute(&id, &h.buyer);
    h.c().resolve_dispute(&id, &0u32);
    assert_eq!(h.tok().balance(&h.buyer), amount);
    assert_eq!(h.tok().balance(&h.seller), 0);
    assert_eq!(h.tok().balance(&h.escrow), 0);
    h.cleanup();
}

// â”€â”€ Test 10: Resolve non-disputed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
#[should_panic(expected = "trade must be in Disputed status")]
fn test_resolve_fails_on_non_disputed_trade() {
    let h = H::new();
    let id = h.funded_trade(100_000_000);
    h.c().resolve_dispute(&id, &5_000u32);
    h.cleanup();
}

// â”€â”€ Test 11: Invalid bps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
#[should_panic(expected = "seller_gets_bps must be <= 10000")]
fn test_resolve_rejects_invalid_bps() {
    let h = H::new();
    let id = h.funded_trade(100_000_000);
    h.c().initiate_dispute(&id, &h.buyer);
    h.c().resolve_dispute(&id, &10_001u32);
    h.cleanup();
}

// â”€â”€ Test 12: Dispute completed trade â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
#[should_panic(expected = "can only dispute a Funded or Delivered trade")]
fn test_dispute_fails_on_completed_trade() {
    let h = H::new();
    let id = h.funded_trade(100_000_000);
    h.c().confirm_delivery(&id);
    h.c().release_funds(&id);
    h.c().initiate_dispute(&id, &h.buyer);
    h.cleanup();
}

// â”€â”€ Test 13: Mock state cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
fn test_mock_state_wiped_after_cleanup() {
    ipfs_upload(&[1u8], 999);
    db_upsert(DbTrade {
        trade_id: 999,
        amount_usdc: 1,
        status: DbStatus::Funded,
        evidence_cid: None,
    });
    ipfs_reset();
    db_reset();
    assert!(ipfs_get(999).is_none(), "IPFS state must be wiped");
    assert!(db_get(999).is_none(), "DB state must be wiped");
}
