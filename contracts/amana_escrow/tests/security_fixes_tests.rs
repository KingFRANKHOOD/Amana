/// Regression tests for:
///   #1406 — path-payment finalization must not count cNGN deposited for other trades
///   #1407 — multisig threshold must gate fee, fee-withdrawal and mediator changes
///   #1408 — terminal trade status is persisted before external token transfers
extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus, PATH_PAYMENT_TIMEOUT_SECS};
use soroban_sdk::{
    Address, Env, Vec,
    testutils::{Address as _, Ledger},
    token,
};

const AMOUNT: i128 = 10_000_000_000;

struct Harness {
    env: Env,
    contract_id: Address,
    cngn_id: Address,
    ngn_id: Address,
    admins: std::vec::Vec<Address>,
    buyer: Address,
    seller: Address,
}

impl Harness {
    fn new(num_admins: u32, threshold: u32) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let mut admin_vec = Vec::new(&env);
        let mut admins = std::vec::Vec::new();
        for _ in 0..num_admins {
            let a = Address::generate(&env);
            admin_vec.push_back(a.clone());
            admins.push(a);
        }
        let issuer = Address::generate(&env);
        let cngn_id = env
            .register_stellar_asset_contract_v2(issuer.clone())
            .address();
        let ngn_id = env.register_stellar_asset_contract_v2(issuer).address();
        let treasury = Address::generate(&env);
        let contract_id = env.register(EscrowContract, ());
        EscrowContractClient::new(&env, &contract_id).initialize(
            &admin_vec, &threshold, &cngn_id, &treasury, &100u32, &ngn_id,
        );
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        Harness { env, contract_id, cngn_id, ngn_id, admins, buyer, seller }
    }

    fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.contract_id)
    }

    fn mint_cngn(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.cngn_id).mint(to, &amount);
    }

    fn mint_ngn(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.ngn_id).mint(to, &amount);
    }

    fn cngn_balance(&self, of: &Address) -> i128 {
        token::Client::new(&self.env, &self.cngn_id).balance(of)
    }

    fn ngn_balance(&self, of: &Address) -> i128 {
        token::Client::new(&self.env, &self.ngn_id).balance(of)
    }

    fn trade(&self, buyer: &Address, seller: &Address) -> u64 {
        self.client()
            .create_trade(buyer, seller, &AMOUNT, &5000u32, &5000u32, &None)
    }

    fn funded_trade(&self) -> u64 {
        self.mint_cngn(&self.buyer, AMOUNT);
        let tid = self.trade(&self.buyer, &self.seller);
        self.client().deposit(&tid);
        tid
    }

    fn deadline(&self) -> u64 {
        self.env.ledger().timestamp() + 1_000
    }
}

// ---------------------------------------------------------------------------
// #1406 — path payment balance-delta isolation
// ---------------------------------------------------------------------------

#[test]
fn finalize_path_payment_ignores_unrelated_deposit() {
    let h = Harness::new(1, 1);
    let attacker = Address::generate(&h.env);
    let colluding_seller = Address::generate(&h.env);

    // 1. Attacker starts a tiny path payment on trade A and does not finalize.
    h.mint_ngn(&attacker, 1);
    let trade_a = h.trade(&attacker, &colluding_seller);
    h.client()
        .deposit_with_path(&trade_a, &attacker, &1, &1, &Vec::new(&h.env));

    // 2. Victim funds unrelated trade B with a large plain deposit.
    let trade_b = h.funded_trade();

    // 3. Only a small amount of swap proceeds actually arrives for A.
    let swap_proceeds = 5_i128;
    h.mint_cngn(&h.contract_id, swap_proceeds);

    // 4. Finalization must credit A with its own proceeds only.
    h.client().finalize_path_payment(&trade_a, &attacker);
    assert_eq!(h.client().get_trade(&trade_a).amount, swap_proceeds);

    // 5. Trade B remains fully backed and can still complete.
    h.client().confirm_delivery(&trade_b);
    h.client().release_funds(&trade_b, &h.buyer);
    assert_eq!(h.client().get_trade(&trade_b).status, TradeStatus::Completed);
}

#[test]
#[should_panic(expected = "Path payment: dest_amount below dest_min")]
fn finalize_path_payment_cannot_claim_other_trade_deposit_to_meet_dest_min() {
    let h = Harness::new(1, 1);
    let attacker = Address::generate(&h.env);
    h.mint_ngn(&attacker, 1);
    let trade_a = h.trade(&attacker, &h.seller);
    h.client()
        .deposit_with_path(&trade_a, &attacker, &1, &1, &Vec::new(&h.env));

    // Victim's deposit lands, but no swap proceeds arrive for trade A.
    h.funded_trade();

    h.client().finalize_path_payment(&trade_a, &attacker);
}

#[test]
#[should_panic(expected = "Another path payment is pending")]
fn only_one_path_payment_can_be_pending() {
    let h = Harness::new(1, 1);
    let other_buyer = Address::generate(&h.env);
    h.mint_ngn(&h.buyer, 10);
    h.mint_ngn(&other_buyer, 10);
    let t1 = h.trade(&h.buyer, &h.seller);
    let t2 = h.trade(&other_buyer, &h.seller);
    h.client()
        .deposit_with_path(&t1, &h.buyer, &10, &1, &Vec::new(&h.env));
    h.client()
        .deposit_with_path(&t2, &other_buyer, &10, &1, &Vec::new(&h.env));
}

#[test]
fn stale_path_payment_is_refunded_and_slot_released() {
    let h = Harness::new(1, 1);
    let other_buyer = Address::generate(&h.env);
    h.mint_ngn(&h.buyer, 10);
    h.mint_ngn(&other_buyer, 10);
    let t1 = h.trade(&h.buyer, &h.seller);
    let t2 = h.trade(&other_buyer, &h.seller);
    h.client()
        .deposit_with_path(&t1, &h.buyer, &10, &1, &Vec::new(&h.env));

    h.env
        .ledger()
        .with_mut(|l| l.timestamp += PATH_PAYMENT_TIMEOUT_SECS);
    h.client()
        .deposit_with_path(&t2, &other_buyer, &10, &1, &Vec::new(&h.env));

    assert_eq!(h.ngn_balance(&h.buyer), 10, "stale intent refunded");
}

#[test]
fn buyer_can_cancel_pending_path_payment() {
    let h = Harness::new(1, 1);
    h.mint_ngn(&h.buyer, 10);
    let t1 = h.trade(&h.buyer, &h.seller);
    h.client()
        .deposit_with_path(&t1, &h.buyer, &10, &1, &Vec::new(&h.env));
    h.client().cancel_path_payment(&t1, &h.buyer);
    assert_eq!(h.ngn_balance(&h.buyer), 10);
}

// ---------------------------------------------------------------------------
// #1407 — multisig threshold enforcement
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "multisig threshold > 1: use a proposal")]
fn single_admin_cannot_add_mediator_when_threshold_above_one() {
    let h = Harness::new(5, 3);
    let rogue = Address::generate(&h.env);
    h.client().add_mediator(&h.admins[0], &rogue);
}

#[test]
#[should_panic(expected = "multisig threshold > 1: use a proposal")]
fn single_admin_cannot_set_mediator_when_threshold_above_one() {
    let h = Harness::new(5, 3);
    let rogue = Address::generate(&h.env);
    h.client().set_mediator(&h.admins[0], &rogue);
}

#[test]
#[should_panic(expected = "multisig threshold > 1: use a proposal")]
fn single_admin_cannot_remove_mediator_when_threshold_above_one() {
    let h = Harness::new(5, 3);
    let m = Address::generate(&h.env);
    h.client().remove_mediator(&h.admins[0], &m);
}

#[test]
#[should_panic(expected = "multisig threshold > 1: use a proposal")]
fn single_admin_cannot_update_fee_when_threshold_above_one() {
    let h = Harness::new(5, 3);
    h.client().update_fee_bps(&h.admins[0], &200u32);
}

#[test]
#[should_panic(expected = "multisig threshold > 1: use a proposal")]
fn single_admin_cannot_withdraw_fees_when_threshold_above_one() {
    let h = Harness::new(5, 3);
    let dest = Address::generate(&h.env);
    h.client().withdraw_fees(&h.admins[0], &1, &dest);
}

#[test]
#[should_panic(expected = "Unauthorized caller")]
fn single_admin_cannot_force_cancel_funded_trade_when_threshold_above_one() {
    let h = Harness::new(5, 3);
    let tid = h.funded_trade();
    h.client().cancel_trade(&tid, &h.admins[0]);
}

#[test]
#[should_panic(expected = "Unauthorized caller")]
fn single_admin_cannot_release_funds_when_threshold_above_one() {
    let h = Harness::new(5, 3);
    let tid = h.funded_trade();
    h.client().confirm_delivery(&tid);
    h.client().release_funds(&tid, &h.admins[0]);
}

#[test]
fn add_mediator_proposal_executes_only_at_threshold() {
    let h = Harness::new(5, 3);
    let mediator = Address::generate(&h.env);
    let pid = h
        .client()
        .propose_add_mediator(&h.admins[0], &mediator, &h.deadline());

    h.client().approve_proposal(&h.admins[0], &pid);
    h.client().approve_proposal(&h.admins[1], &pid);
    assert!(!h.client().is_mediator(&mediator), "2 of 3 must not suffice");

    h.client().approve_proposal(&h.admins[2], &pid);
    assert!(h.client().is_mediator(&mediator));
}

#[test]
fn fee_update_and_withdrawal_proposals_execute_at_threshold() {
    let h = Harness::new(3, 2);
    let pid = h
        .client()
        .propose_fee_update(&h.admins[0], &250u32, &h.deadline());
    h.client().approve_proposal(&h.admins[0], &pid);
    assert_eq!(h.client().get_fee_bps(), 100);
    h.client().approve_proposal(&h.admins[1], &pid);
    assert_eq!(h.client().get_fee_bps(), 250);

    // Accrue some fees, then withdraw them via proposal.
    let tid = h.funded_trade();
    h.client().confirm_delivery(&tid);
    h.client().release_funds(&tid, &h.buyer);
    let fees = h.client().get_accrued_fees();
    assert!(fees > 0);

    let dest = Address::generate(&h.env);
    let pid = h
        .client()
        .propose_withdraw_fees(&h.admins[1], &fees, &dest, &h.deadline());
    h.client().approve_proposal(&h.admins[1], &pid);
    assert_eq!(h.cngn_balance(&dest), 0);
    h.client().approve_proposal(&h.admins[2], &pid);
    assert_eq!(h.cngn_balance(&dest), fees);
    assert_eq!(h.client().get_accrued_fees(), 0);
}

#[test]
fn single_admin_deployment_keeps_direct_entry_points() {
    let h = Harness::new(1, 1);
    let mediator = Address::generate(&h.env);
    h.client().add_mediator(&h.admins[0], &mediator);
    assert!(h.client().is_mediator(&mediator));
    h.client().update_fee_bps(&h.admins[0], &200u32);
    assert_eq!(h.client().get_fee_bps(), 200);
}

// ---------------------------------------------------------------------------
// #1408 — checks-effects-interactions: status persisted before transfer
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Trade must be delivered")]
fn release_funds_cannot_pay_out_twice() {
    let h = Harness::new(1, 1);
    let tid = h.funded_trade();
    h.client().confirm_delivery(&tid);
    h.client().release_funds(&tid, &h.buyer);
    assert_eq!(h.client().get_trade(&tid).status, TradeStatus::Completed);
    h.client().release_funds(&tid, &h.buyer);
}

#[test]
#[should_panic(expected = "Trade must be in Funded status to claim expiry refund")]
fn claim_expiry_refund_cannot_refund_twice() {
    let h = Harness::new(1, 1);
    h.mint_cngn(&h.buyer, AMOUNT);
    let expires_at = h.env.ledger().timestamp() + 10;
    let tid = h.client().create_trade(
        &h.buyer, &h.seller, &AMOUNT, &5000u32, &5000u32, &Some(expires_at),
    );
    h.client().deposit(&tid);
    h.env.ledger().with_mut(|l| l.timestamp = expires_at);
    h.client().claim_expiry_refund(&tid, &h.buyer);
    assert_eq!(h.client().get_trade(&tid).status, TradeStatus::Cancelled);
    assert_eq!(h.cngn_balance(&h.buyer), AMOUNT);
    h.client().claim_expiry_refund(&tid, &h.buyer);
}

#[test]
#[should_panic(expected = "Trade must be in Disputed status")]
fn resolve_dispute_cannot_pay_out_twice() {
    let h = Harness::new(1, 1);
    let mediator = Address::generate(&h.env);
    h.client().add_mediator(&h.admins[0], &mediator);
    let tid = h.funded_trade();
    h.client().initiate_dispute(
        &tid,
        &h.buyer,
        &soroban_sdk::String::from_str(&h.env, "QmReason"),
    );
    h.client().resolve_dispute(&tid, &mediator, &5000u32);
    assert_eq!(h.client().get_trade(&tid).status, TradeStatus::Completed);
    h.client().resolve_dispute(&tid, &mediator, &5000u32);
}

#[test]
#[should_panic(expected = "CannotCancelTradeInCurrentStatus")]
fn cancellation_refund_cannot_be_repeated() {
    let h = Harness::new(1, 1);
    let tid = h.funded_trade();
    h.client().cancel_trade(&tid, &h.buyer);
    h.client().cancel_trade(&tid, &h.seller);
    assert_eq!(h.client().get_trade(&tid).status, TradeStatus::Cancelled);
    assert_eq!(h.cngn_balance(&h.buyer), AMOUNT);
    h.client().cancel_trade(&tid, &h.admins[0]);
}
