//! Issue #555 — Hardening contract inputs against malformed user payloads.
//!
//! Verifies that every caller-supplied string/ratio input is rejected when it is
//! empty (where required) or exceeds `MAX_HASH_LEN`, while well-formed inputs
//! (including a payload at exactly the length bound) continue to succeed.
extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, MAX_HASH_LEN};
use soroban_sdk::{
    Address, Env, String as SorobanString, contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
};

// ---------------------------------------------------------------------------
// Minimal mock cNGN token (mirrors the harness used by the other test crates)
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
        H {
            env,
            escrow,
            token,
            admin,
            buyer,
            seller,
            mediator,
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
            .initialize(&self.admin, &self.token, &self.admin, &0u32);
        self.c().set_mediator(&self.mediator);
    }

    /// Initialize, fund a trade and return its id (status = Funded).
    fn funded(&self, amount: i128) -> u64 {
        self.init();
        self.tok().mint(&self.buyer, &amount);
        let trade_id =
            self.c()
                .create_trade(&self.buyer, &self.seller, &amount, &5000u32, &5000u32);
        self.c().deposit(&trade_id);
        trade_id
    }

    /// Funded trade moved into Disputed status.
    fn disputed(&self, amount: i128) -> u64 {
        let trade_id = self.funded(amount);
        self.c().initiate_dispute(
            &trade_id,
            &self.buyer,
            &SorobanString::from_str(&self.env, "QmReasonDispute"),
        );
        trade_id
    }

    fn s(&self, value: &str) -> SorobanString {
        SorobanString::from_str(&self.env, value)
    }

    /// A string `len` bytes long, built from a single ASCII byte.
    fn long(&self, len: usize) -> SorobanString {
        let big = "a".repeat(len);
        SorobanString::from_str(&self.env, &big)
    }
}

// ---------------------------------------------------------------------------
// create_trade — loss-ratio bounds
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "buyer_loss_bps must not exceed 10000")]
fn create_trade_rejects_out_of_range_buyer_bps() {
    let h = H::new();
    h.init();
    h.tok().mint(&h.buyer, &100i128);
    h.c()
        .create_trade(&h.buyer, &h.seller, &100i128, &10_001u32, &0u32);
}

#[test]
#[should_panic(expected = "seller_loss_bps must not exceed 10000")]
fn create_trade_rejects_out_of_range_seller_bps() {
    let h = H::new();
    h.init();
    h.tok().mint(&h.buyer, &100i128);
    h.c()
        .create_trade(&h.buyer, &h.seller, &100i128, &0u32, &10_001u32);
}

// ---------------------------------------------------------------------------
// initiate_dispute — reason_hash bound
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "reason_hash exceeds max length")]
fn initiate_dispute_rejects_oversized_reason_hash() {
    let h = H::new();
    let trade_id = h.funded(100_000_000);
    let oversized = h.long((MAX_HASH_LEN + 1) as usize);
    h.c().initiate_dispute(&trade_id, &h.buyer, &oversized);
}

// ---------------------------------------------------------------------------
// submit_evidence — non-empty ipfs_hash + length bounds
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "ipfs_hash must not be empty")]
fn submit_evidence_rejects_empty_ipfs_hash() {
    let h = H::new();
    let trade_id = h.disputed(100_000_000);
    h.c()
        .submit_evidence(&trade_id, &h.buyer, &h.s(""), &h.s("desc"));
}

#[test]
#[should_panic(expected = "ipfs_hash exceeds max length")]
fn submit_evidence_rejects_oversized_ipfs_hash() {
    let h = H::new();
    let trade_id = h.disputed(100_000_000);
    let oversized = h.long((MAX_HASH_LEN + 1) as usize);
    h.c()
        .submit_evidence(&trade_id, &h.buyer, &oversized, &h.s("desc"));
}

#[test]
#[should_panic(expected = "description_hash exceeds max length")]
fn submit_evidence_rejects_oversized_description_hash() {
    let h = H::new();
    let trade_id = h.disputed(100_000_000);
    let oversized = h.long((MAX_HASH_LEN + 1) as usize);
    h.c()
        .submit_evidence(&trade_id, &h.buyer, &h.s("QmEvidence"), &oversized);
}

// ---------------------------------------------------------------------------
// submit_video_proof — ipfs_cid bound
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "ipfs_cid exceeds max length")]
fn submit_video_proof_rejects_oversized_cid() {
    let h = H::new();
    let trade_id = h.funded(100_000_000);
    let oversized = h.long((MAX_HASH_LEN + 1) as usize);
    h.c().submit_video_proof(&trade_id, &h.buyer, &oversized);
}

// ---------------------------------------------------------------------------
// submit_manifest — driver hash bounds
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "driver_name_hash exceeds max length")]
fn submit_manifest_rejects_oversized_driver_name_hash() {
    let h = H::new();
    let trade_id = h.funded(100_000_000);
    let oversized = h.long((MAX_HASH_LEN + 1) as usize);
    h.c()
        .submit_manifest(&trade_id, &h.seller, &oversized, &h.s("QmDriverId"));
}

// ---------------------------------------------------------------------------
// Positive paths — valid and exactly-at-bound inputs still succeed
// ---------------------------------------------------------------------------

#[test]
fn submit_evidence_accepts_input_at_exact_length_bound() {
    let h = H::new();
    let trade_id = h.disputed(100_000_000);
    // A payload of exactly MAX_HASH_LEN bytes must be accepted.
    let at_bound = h.long(MAX_HASH_LEN as usize);
    h.c()
        .submit_evidence(&trade_id, &h.buyer, &at_bound, &h.s(""));
    let list = h.c().get_evidence_list(&trade_id);
    assert_eq!(list.len(), 1);
    assert_eq!(list.get(0).unwrap().submitter, h.buyer);
}

#[test]
fn well_formed_cid_still_flows_through_unchanged() {
    let h = H::new();
    let trade_id = h.disputed(100_000_000);
    let cid = h.s("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG");
    h.c()
        .submit_evidence(&trade_id, &h.seller, &cid, &h.s("packaging photos"));
    let list = h.c().get_evidence_list(&trade_id);
    assert_eq!(list.len(), 1);
    assert_eq!(list.get(0).unwrap().ipfs_hash, cid);
}
