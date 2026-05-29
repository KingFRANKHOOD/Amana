/// Issue #389 — Multi-party dispute stress scenarios.
///
/// Covers:
///   - Repeated evidence submissions from all parties in varying order
///   - Mediator registry churn (add/remove) interleaved with evidence
///   - Evidence list ordering is deterministic (FIFO)
///   - Evidence hashes are immutable after submission
///   - Evidence is preserved after resolution
///   - Settlement invariants hold after all interleaved operations
extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use soroban_sdk::{Address, Env, String as SStr, testutils::{Address as _, Ledger as _}, token};

// ---------------------------------------------------------------------------
// Shared harness
// ---------------------------------------------------------------------------

struct Stress {
    env: Env,
    contract_id: Address,
    usdc_id: Address,
    admin: Address,
    buyer: Address,
    seller: Address,
    treasury: Address,
}

impl Stress {
    fn new(fee_bps: u32) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register(EscrowContract, ());
        EscrowContractClient::new(&env, &contract_id)
            .initialize(&admin, &usdc_id, &treasury, &fee_bps);
        Stress { env, contract_id, usdc_id, admin, buyer, seller, treasury }
    }

    fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.contract_id)
    }

    fn mint(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.usdc_id).mint(to, &amount);
    }

    fn tok(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.usdc_id)
    }

    fn disputed_trade(&self, amount: i128) -> u64 {
        self.mint(&self.buyer, amount);
        let tid = self.client().create_trade(
            &self.buyer, &self.seller, &amount, &5000u32, &5000u32,
        );
        self.client().deposit(&tid);
        self.client().initiate_dispute(
            &tid, &self.buyer, &SStr::from_str(&self.env, "QmStressDispute"),
        );
        tid
    }
}

// ---------------------------------------------------------------------------
// Stress 1: 10 sequential evidence submissions — FIFO order preserved
// ---------------------------------------------------------------------------

#[test]
fn test_stress_evidence_fifo_order_10_submissions() {
    let s = Stress::new(100);
    let mediator = Address::generate(&s.env);
    s.client().add_mediator(&mediator);

    let tid = s.disputed_trade(100_000);

    // Alternate buyer / seller / mediator submissions
    let submitters = [
        s.buyer.clone(), s.seller.clone(), s.buyer.clone(),
        mediator.clone(), s.seller.clone(), s.buyer.clone(),
        s.seller.clone(), mediator.clone(), s.buyer.clone(), s.seller.clone(),
    ];

    for (i, submitter) in submitters.iter().enumerate() {
        s.env.ledger().with_mut(|l| l.timestamp = 1_000 + i as u64 * 100);
        let cid = SStr::from_str(&s.env, &std::format!("QmEvidence{i:03}"));
        let desc = SStr::from_str(&s.env, "desc");
        s.client().submit_evidence(&tid, submitter, &cid, &desc);
    }

    let list = s.client().get_evidence_list(&tid);
    assert_eq!(list.len(), 10, "all 10 submissions must be stored");

    // Verify FIFO: timestamps must be non-decreasing
    for i in 1..list.len() {
        assert!(
            list.get(i).unwrap().submitted_at >= list.get(i - 1).unwrap().submitted_at,
            "[#389] evidence order not FIFO at index {i}"
        );
    }

    // Verify submitter order matches insertion order
    for (i, expected) in submitters.iter().enumerate() {
        assert_eq!(
            list.get(i as u32).unwrap().submitter,
            *expected,
            "[#389] submitter mismatch at index {i}"
        );
    }
}

// ---------------------------------------------------------------------------
// Stress 2: Evidence hashes are immutable — re-reading returns original values
// ---------------------------------------------------------------------------

#[test]
fn test_stress_evidence_hash_immutable_after_submission() {
    let s = Stress::new(100);
    let mediator = Address::generate(&s.env);
    s.client().add_mediator(&mediator);

    let tid = s.disputed_trade(50_000);

    let cid_buyer = SStr::from_str(&s.env, "QmBuyerImmutableHash");
    let cid_seller = SStr::from_str(&s.env, "QmSellerImmutableHash");

    s.client().submit_evidence(&tid, &s.buyer, &cid_buyer, &SStr::from_str(&s.env, "d1"));
    s.client().submit_evidence(&tid, &s.seller, &cid_seller, &SStr::from_str(&s.env, "d2"));

    // Submit more evidence — must not overwrite earlier entries
    s.client().submit_evidence(&tid, &s.buyer, &SStr::from_str(&s.env, "QmBuyerSecond"), &SStr::from_str(&s.env, "d3"));

    let list = s.client().get_evidence_list(&tid);
    assert_eq!(list.len(), 3);

    // First entry must still hold the original hash
    assert_eq!(
        list.get(0).unwrap().ipfs_hash, cid_buyer,
        "[#389] first evidence hash mutated"
    );
    assert_eq!(
        list.get(1).unwrap().ipfs_hash, cid_seller,
        "[#389] second evidence hash mutated"
    );
}

// ---------------------------------------------------------------------------
// Stress 3: Evidence order is deterministic under mixed-party submissions
// ---------------------------------------------------------------------------

#[test]
fn test_stress_evidence_order_deterministic_mixed_parties() {
    let s = Stress::new(100);
    let mediator_a = Address::generate(&s.env);
    let mediator_b = Address::generate(&s.env);
    s.client().add_mediator(&mediator_a);
    s.client().add_mediator(&mediator_b);

    let tid = s.disputed_trade(200_000);

    let sequence: &[(&Address, &str)] = &[
        (&s.buyer,    "QmA"),
        (&mediator_a, "QmB"),
        (&s.seller,   "QmC"),
        (&mediator_b, "QmD"),
        (&s.buyer,    "QmE"),
        (&s.seller,   "QmF"),
    ];

    for (i, (submitter, cid_str)) in sequence.iter().enumerate() {
        s.env.ledger().with_mut(|l| l.timestamp = 2_000 + i as u64 * 50);
        s.client().submit_evidence(
            &tid, submitter,
            &SStr::from_str(&s.env, cid_str),
            &SStr::from_str(&s.env, "desc"),
        );
    }

    let list = s.client().get_evidence_list(&tid);
    assert_eq!(list.len(), 6);

    for (i, (_, cid_str)) in sequence.iter().enumerate() {
        assert_eq!(
            list.get(i as u32).unwrap().ipfs_hash,
            SStr::from_str(&s.env, cid_str),
            "[#389] evidence order mismatch at index {i}"
        );
    }
}

// ---------------------------------------------------------------------------
// Stress 4: Mediator registry churn interleaved with evidence submissions
// ---------------------------------------------------------------------------

#[test]
fn test_stress_registry_churn_interleaved_with_evidence() {
    let s = Stress::new(100);

    let med_a = Address::generate(&s.env);
    let med_b = Address::generate(&s.env);
    let med_c = Address::generate(&s.env);

    // Add all three mediators
    s.client().add_mediator(&med_a);
    s.client().add_mediator(&med_b);
    s.client().add_mediator(&med_c);

    let tid = s.disputed_trade(100_000);

    // med_a submits evidence
    s.client().submit_evidence(&tid, &med_a, &SStr::from_str(&s.env, "QmMedA1"), &SStr::from_str(&s.env, "d"));

    // Remove med_b (registry churn)
    s.client().remove_mediator(&med_b);

    // med_a submits more evidence (still valid)
    s.client().submit_evidence(&tid, &med_a, &SStr::from_str(&s.env, "QmMedA2"), &SStr::from_str(&s.env, "d"));

    // buyer submits evidence
    s.client().submit_evidence(&tid, &s.buyer, &SStr::from_str(&s.env, "QmBuyer1"), &SStr::from_str(&s.env, "d"));

    // Re-add med_b
    s.client().add_mediator(&med_b);

    // med_b submits evidence (now valid again)
    s.client().submit_evidence(&tid, &med_b, &SStr::from_str(&s.env, "QmMedB1"), &SStr::from_str(&s.env, "d"));

    let list = s.client().get_evidence_list(&tid);
    assert_eq!(list.len(), 4, "[#389] evidence count mismatch after registry churn");

    // Verify FIFO order is preserved despite registry churn
    let expected_cids = ["QmMedA1", "QmMedA2", "QmBuyer1", "QmMedB1"];
    for (i, cid) in expected_cids.iter().enumerate() {
        assert_eq!(
            list.get(i as u32).unwrap().ipfs_hash,
            SStr::from_str(&s.env, cid),
            "[#389] evidence order broken by registry churn at index {i}"
        );
    }

    // med_c resolves — must succeed (still registered)
    s.client().resolve_dispute(&tid, &med_c, &6_000u32);
    assert!(matches!(s.client().get_trade(&tid).status, TradeStatus::Completed));
}

// ---------------------------------------------------------------------------
// Stress 5: Evidence preserved after resolution — immutability invariant
// ---------------------------------------------------------------------------

#[test]
fn test_stress_evidence_preserved_after_resolution() {
    let s = Stress::new(100);
    let mediator = Address::generate(&s.env);
    s.client().add_mediator(&mediator);

    let tid = s.disputed_trade(100_000);

    let cids = ["QmPre1", "QmPre2", "QmPre3"];
    for cid in &cids {
        s.client().submit_evidence(
            &tid, &s.buyer,
            &SStr::from_str(&s.env, cid),
            &SStr::from_str(&s.env, "desc"),
        );
    }

    s.client().resolve_dispute(&tid, &mediator, &7_000u32);

    // Evidence list must be unchanged after resolution
    let list = s.client().get_evidence_list(&tid);
    assert_eq!(list.len(), 3, "[#389] evidence count changed after resolution");
    for (i, cid) in cids.iter().enumerate() {
        assert_eq!(
            list.get(i as u32).unwrap().ipfs_hash,
            SStr::from_str(&s.env, cid),
            "[#389] evidence hash changed after resolution at index {i}"
        );
    }
}

// ---------------------------------------------------------------------------
// Stress 6: Settlement invariants hold after interleaved operations
// ---------------------------------------------------------------------------

#[test]
fn test_stress_settlement_invariants_after_interleaved_ops() {
    let s = Stress::new(100);
    let med_a = Address::generate(&s.env);
    let med_b = Address::generate(&s.env);
    s.client().add_mediator(&med_a);
    s.client().add_mediator(&med_b);

    let amount = 500_000i128;
    let tid = s.disputed_trade(amount);

    // Interleave: evidence + registry churn
    s.client().submit_evidence(&tid, &s.buyer, &SStr::from_str(&s.env, "QmB1"), &SStr::from_str(&s.env, "d"));
    s.client().remove_mediator(&med_b);
    s.client().submit_evidence(&tid, &s.seller, &SStr::from_str(&s.env, "QmS1"), &SStr::from_str(&s.env, "d"));
    s.client().add_mediator(&med_b);
    s.client().submit_evidence(&tid, &med_a, &SStr::from_str(&s.env, "QmM1"), &SStr::from_str(&s.env, "d"));

    // Resolve with med_a
    s.client().resolve_dispute(&tid, &med_a, &8_000u32);

    let seller_bal = s.tok().balance(&s.seller);
    let buyer_bal = s.tok().balance(&s.buyer);
    let treasury_bal = s.tok().balance(&s.treasury);
    let escrow_bal = s.tok().balance(&s.contract_id);

    // Conservation invariant
    assert_eq!(
        seller_bal + buyer_bal + treasury_bal + escrow_bal,
        amount,
        "[#389] settlement conservation violated"
    );
    // Escrow must be fully drained
    assert_eq!(escrow_bal, 0, "[#389] escrow not empty after settlement");
    // Non-negativity
    assert!(seller_bal >= 0 && buyer_bal >= 0 && treasury_bal >= 0);
    // Trade is Completed
    assert!(matches!(s.client().get_trade(&tid).status, TradeStatus::Completed));
}

// ---------------------------------------------------------------------------
// Stress 7: Repeated evidence submissions do not affect settlement math
// ---------------------------------------------------------------------------

#[test]
fn test_stress_repeated_evidence_does_not_affect_settlement() {
    let s = Stress::new(100);
    let mediator = Address::generate(&s.env);
    s.client().add_mediator(&mediator);

    let amount = 10_000i128;
    let tid = s.disputed_trade(amount);

    // Submit 20 evidence entries
    for i in 0..20u32 {
        let cid = SStr::from_str(&s.env, &std::format!("QmEvidence{i:03}"));
        let submitter = if i % 2 == 0 { &s.buyer } else { &s.seller };
        s.client().submit_evidence(&tid, submitter, &cid, &SStr::from_str(&s.env, "d"));
    }

    assert_eq!(s.client().get_evidence_list(&tid).len(), 20);

    // Resolve — settlement must be identical to a trade with no evidence
    s.client().resolve_dispute(&tid, &mediator, &5_000u32);

    let seller_bal = s.tok().balance(&s.seller);
    let buyer_bal = s.tok().balance(&s.buyer);
    let treasury_bal = s.tok().balance(&s.treasury);

    assert_eq!(
        seller_bal + buyer_bal + treasury_bal,
        amount,
        "[#389] settlement affected by evidence count"
    );
    assert_eq!(s.tok().balance(&s.contract_id), 0);
}

// ---------------------------------------------------------------------------
// Stress 8: Cannot submit evidence after resolution (immutability post-settlement)
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Evidence can only be submitted for a Disputed trade")]
fn test_stress_evidence_rejected_after_resolution() {
    let s = Stress::new(100);
    let mediator = Address::generate(&s.env);
    s.client().add_mediator(&mediator);

    let tid = s.disputed_trade(10_000);
    s.client().submit_evidence(&tid, &s.buyer, &SStr::from_str(&s.env, "QmPre"), &SStr::from_str(&s.env, "d"));
    s.client().resolve_dispute(&tid, &mediator, &5_000u32);

    // Must panic — trade is Completed
    s.client().submit_evidence(&tid, &s.buyer, &SStr::from_str(&s.env, "QmPost"), &SStr::from_str(&s.env, "d"));
}

// ---------------------------------------------------------------------------
// Stress 9: Removed mediator cannot resolve even after evidence interleaving
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Unauthorized mediator")]
fn test_stress_removed_mediator_blocked_after_evidence_interleave() {
    let s = Stress::new(100);
    let med_a = Address::generate(&s.env);
    let med_b = Address::generate(&s.env);
    s.client().add_mediator(&med_a);
    s.client().add_mediator(&med_b);

    let tid = s.disputed_trade(10_000);

    // Interleave evidence and registry ops
    s.client().submit_evidence(&tid, &s.buyer, &SStr::from_str(&s.env, "QmB1"), &SStr::from_str(&s.env, "d"));
    s.client().remove_mediator(&med_a);
    s.client().submit_evidence(&tid, &s.seller, &SStr::from_str(&s.env, "QmS1"), &SStr::from_str(&s.env, "d"));

    // med_a was removed — must panic
    s.client().resolve_dispute(&tid, &med_a, &5_000u32);
}

// ---------------------------------------------------------------------------
// Stress 10: Multiple trades in parallel — evidence lists are isolated
// ---------------------------------------------------------------------------

#[test]
fn test_stress_evidence_lists_isolated_across_trades() {
    let s = Stress::new(100);
    let mediator = Address::generate(&s.env);
    s.client().add_mediator(&mediator);

    // Create two independent disputed trades
    let amount = 10_000i128;
    s.mint(&s.buyer, amount * 2);

    let tid_a = {
        let tid = s.client().create_trade(&s.buyer, &s.seller, &amount, &5000u32, &5000u32);
        s.client().deposit(&tid);
        s.client().initiate_dispute(&tid, &s.buyer, &SStr::from_str(&s.env, "QmDisputeA"));
        tid
    };
    let tid_b = {
        let tid = s.client().create_trade(&s.buyer, &s.seller, &amount, &5000u32, &5000u32);
        s.client().deposit(&tid);
        s.client().initiate_dispute(&tid, &s.buyer, &SStr::from_str(&s.env, "QmDisputeB"));
        tid
    };

    // Submit evidence to trade A only
    s.client().submit_evidence(&tid_a, &s.buyer, &SStr::from_str(&s.env, "QmOnlyA"), &SStr::from_str(&s.env, "d"));

    // Trade B must have empty evidence list
    assert_eq!(
        s.client().get_evidence_list(&tid_b).len(), 0,
        "[#389] evidence leaked between trades"
    );
    assert_eq!(s.client().get_evidence_list(&tid_a).len(), 1);

    // Resolve both independently
    s.client().resolve_dispute(&tid_a, &mediator, &6_000u32);
    s.client().resolve_dispute(&tid_b, &mediator, &4_000u32);

    assert!(matches!(s.client().get_trade(&tid_a).status, TradeStatus::Completed));
    assert!(matches!(s.client().get_trade(&tid_b).status, TradeStatus::Completed));
}
