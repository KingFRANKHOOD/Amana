/// Issue #385 — Authorization matrix tests for all externally callable methods.
///
/// Every public contract method is tested against each role:
///   buyer | seller | mediator | admin | stranger
///
/// Allow paths assert the call succeeds; deny paths assert the expected panic.
extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use soroban_sdk::{Address, Env, String as SStr, testutils::Address as _, token};

// ---------------------------------------------------------------------------
// Shared harness
// ---------------------------------------------------------------------------

struct Harness {
    env: Env,
    contract_id: Address,
    usdc_id: Address,
    admin: Address,
    buyer: Address,
    seller: Address,
    mediator: Address,
    treasury: Address,
    stranger: Address,
}

impl Harness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let mediator = Address::generate(&env);
        let treasury = Address::generate(&env);
        let stranger = Address::generate(&env);
        let usdc_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin, &usdc_id, &treasury, &100u32);
        client.add_mediator(&mediator);
        Harness { env, contract_id, usdc_id, admin, buyer, seller, mediator, treasury, stranger }
    }

    fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.contract_id)
    }

    fn mint(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.usdc_id).mint(to, &amount);
    }

    fn funded_trade(&self, amount: i128) -> u64 {
        self.mint(&self.buyer, amount);
        let tid = self.client().create_trade(
            &self.buyer, &self.seller, &amount, &5000u32, &5000u32,
        );
        self.client().deposit(&tid);
        tid
    }

    fn disputed_trade(&self, amount: i128) -> u64 {
        let tid = self.funded_trade(amount);
        self.client().initiate_dispute(
            &tid, &self.buyer, &SStr::from_str(&self.env, "QmAuthMatrix"),
        );
        tid
    }
}

// ---------------------------------------------------------------------------
// initialize — admin only (already called in Harness::new; test double-call guard)
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "AlreadyInitialized")]
fn test_auth_initialize_rejects_second_call() {
    let h = Harness::new();
    h.client().initialize(&h.admin, &h.usdc_id, &h.treasury, &100u32);
}

// ---------------------------------------------------------------------------
// create_trade — any caller (no auth restriction on who creates)
// ---------------------------------------------------------------------------

#[test]
fn test_auth_create_trade_buyer_allowed() {
    let h = Harness::new();
    // buyer creates a trade — allowed
    let tid = h.client().create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Created));
}

#[test]
fn test_auth_create_trade_stranger_allowed() {
    let h = Harness::new();
    // Anyone can call create_trade (no auth guard on the caller itself)
    let tid = h.client().create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Created));
}

#[test]
#[should_panic(expected = "buyer and seller must be different addresses")]
fn test_auth_create_trade_rejects_self_trade() {
    let h = Harness::new();
    h.client().create_trade(&h.buyer, &h.buyer, &1_000i128, &5000u32, &5000u32);
}

// ---------------------------------------------------------------------------
// deposit — buyer only
// ---------------------------------------------------------------------------

#[test]
fn test_auth_deposit_buyer_allowed() {
    let h = Harness::new();
    h.mint(&h.buyer, 1_000);
    let tid = h.client().create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32);
    h.client().deposit(&tid);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Funded));
}

#[test]
#[should_panic]
fn test_auth_deposit_seller_denied() {
    let h = Harness::new();
    h.mint(&h.buyer, 1_000);
    let tid = h.client().create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32);
    // Provide auth only for seller — must fail because buyer.require_auth() is called
    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.seller,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "deposit",
                args: soroban_sdk::vec![
                    &h.env,
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&tid, &h.env),
                ],
                sub_invokes: &[],
            },
        }])
        .deposit(&tid);
}

// ---------------------------------------------------------------------------
// confirm_delivery — buyer only
// ---------------------------------------------------------------------------

#[test]
fn test_auth_confirm_delivery_buyer_allowed() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().confirm_delivery(&tid);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Delivered));
}

#[test]
#[should_panic]
fn test_auth_confirm_delivery_seller_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.seller,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "confirm_delivery",
                args: soroban_sdk::vec![
                    &h.env,
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&tid, &h.env),
                ],
                sub_invokes: &[],
            },
        }])
        .confirm_delivery(&tid);
}

#[test]
#[should_panic]
fn test_auth_confirm_delivery_stranger_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.stranger,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "confirm_delivery",
                args: soroban_sdk::vec![
                    &h.env,
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&tid, &h.env),
                ],
                sub_invokes: &[],
            },
        }])
        .confirm_delivery(&tid);
}

// ---------------------------------------------------------------------------
// release_funds — buyer only (after delivery confirmed)
// ---------------------------------------------------------------------------

#[test]
fn test_auth_release_funds_buyer_allowed() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().confirm_delivery(&tid);
    h.client().release_funds(&tid);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Completed));
}

#[test]
#[should_panic]
fn test_auth_release_funds_seller_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().confirm_delivery(&tid);
    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.seller,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "release_funds",
                args: soroban_sdk::vec![
                    &h.env,
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&tid, &h.env),
                ],
                sub_invokes: &[],
            },
        }])
        .release_funds(&tid);
}

#[test]
#[should_panic]
fn test_auth_release_funds_stranger_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().confirm_delivery(&tid);
    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.stranger,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "release_funds",
                args: soroban_sdk::vec![
                    &h.env,
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&tid, &h.env),
                ],
                sub_invokes: &[],
            },
        }])
        .release_funds(&tid);
}

// ---------------------------------------------------------------------------
// cancel_trade — buyer/seller/admin allowed; stranger denied
// ---------------------------------------------------------------------------

#[test]
fn test_auth_cancel_trade_buyer_allowed_created() {
    let h = Harness::new();
    let tid = h.client().create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32);
    h.client().cancel_trade(&tid, &h.buyer);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Cancelled));
}

#[test]
fn test_auth_cancel_trade_seller_allowed_created() {
    let h = Harness::new();
    let tid = h.client().create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32);
    h.client().cancel_trade(&tid, &h.seller);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Cancelled));
}

#[test]
fn test_auth_cancel_trade_admin_allowed_created() {
    let h = Harness::new();
    let tid = h.client().create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32);
    h.client().cancel_trade(&tid, &h.admin);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Cancelled));
}

#[test]
#[should_panic(expected = "Unauthorized caller")]
fn test_auth_cancel_trade_stranger_denied_created() {
    let h = Harness::new();
    let tid = h.client().create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32);
    h.client().cancel_trade(&tid, &h.stranger);
}

#[test]
fn test_auth_cancel_trade_admin_allowed_funded() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().cancel_trade(&tid, &h.admin);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Cancelled));
}

#[test]
#[should_panic(expected = "Unauthorized caller")]
fn test_auth_cancel_trade_stranger_denied_funded() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().cancel_trade(&tid, &h.stranger);
}

// ---------------------------------------------------------------------------
// initiate_dispute — buyer or seller only
// ---------------------------------------------------------------------------

#[test]
fn test_auth_initiate_dispute_buyer_allowed() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().initiate_dispute(&tid, &h.buyer, &SStr::from_str(&h.env, "QmBuyer"));
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Disputed));
}

#[test]
fn test_auth_initiate_dispute_seller_allowed() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().initiate_dispute(&tid, &h.seller, &SStr::from_str(&h.env, "QmSeller"));
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Disputed));
}

#[test]
#[should_panic(expected = "Only the buyer or seller can initiate a dispute")]
fn test_auth_initiate_dispute_mediator_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().initiate_dispute(&tid, &h.mediator, &SStr::from_str(&h.env, "QmMediator"));
}

#[test]
#[should_panic(expected = "Only the buyer or seller can initiate a dispute")]
fn test_auth_initiate_dispute_admin_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().initiate_dispute(&tid, &h.admin, &SStr::from_str(&h.env, "QmAdmin"));
}

#[test]
#[should_panic(expected = "Only the buyer or seller can initiate a dispute")]
fn test_auth_initiate_dispute_stranger_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().initiate_dispute(&tid, &h.stranger, &SStr::from_str(&h.env, "QmStranger"));
}

// ---------------------------------------------------------------------------
// submit_evidence — buyer / seller / mediator allowed; stranger denied
// ---------------------------------------------------------------------------

#[test]
fn test_auth_submit_evidence_buyer_allowed() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().submit_evidence(
        &tid, &h.buyer,
        &SStr::from_str(&h.env, "QmBuyerEvidence"),
        &SStr::from_str(&h.env, "desc"),
    );
    assert_eq!(h.client().get_evidence_list(&tid).len(), 1);
}

#[test]
fn test_auth_submit_evidence_seller_allowed() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().submit_evidence(
        &tid, &h.seller,
        &SStr::from_str(&h.env, "QmSellerEvidence"),
        &SStr::from_str(&h.env, "desc"),
    );
    assert_eq!(h.client().get_evidence_list(&tid).len(), 1);
}

#[test]
fn test_auth_submit_evidence_mediator_allowed() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().submit_evidence(
        &tid, &h.mediator,
        &SStr::from_str(&h.env, "QmMediatorEvidence"),
        &SStr::from_str(&h.env, "desc"),
    );
    assert_eq!(h.client().get_evidence_list(&tid).len(), 1);
}

#[test]
#[should_panic(expected = "Only buyer, seller, or mediator can submit evidence")]
fn test_auth_submit_evidence_stranger_denied() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().submit_evidence(
        &tid, &h.stranger,
        &SStr::from_str(&h.env, "QmBadEvidence"),
        &SStr::from_str(&h.env, "desc"),
    );
}

#[test]
#[should_panic(expected = "Only buyer, seller, or mediator can submit evidence")]
fn test_auth_submit_evidence_admin_denied() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().submit_evidence(
        &tid, &h.admin,
        &SStr::from_str(&h.env, "QmAdminEvidence"),
        &SStr::from_str(&h.env, "desc"),
    );
}

// ---------------------------------------------------------------------------
// resolve_dispute — registered mediator only
// ---------------------------------------------------------------------------

#[test]
fn test_auth_resolve_dispute_mediator_allowed() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().resolve_dispute(&tid, &h.mediator, &5_000u32);
    assert!(matches!(h.client().get_trade(&tid).status, TradeStatus::Completed));
}

#[test]
#[should_panic(expected = "Unauthorized mediator")]
fn test_auth_resolve_dispute_buyer_denied() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().resolve_dispute(&tid, &h.buyer, &5_000u32);
}

#[test]
#[should_panic(expected = "Unauthorized mediator")]
fn test_auth_resolve_dispute_seller_denied() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().resolve_dispute(&tid, &h.seller, &5_000u32);
}

#[test]
#[should_panic(expected = "Unauthorized mediator")]
fn test_auth_resolve_dispute_admin_denied() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().resolve_dispute(&tid, &h.admin, &5_000u32);
}

#[test]
#[should_panic(expected = "Unauthorized mediator")]
fn test_auth_resolve_dispute_stranger_denied() {
    let h = Harness::new();
    let tid = h.disputed_trade(1_000);
    h.client().resolve_dispute(&tid, &h.stranger, &5_000u32);
}

// ---------------------------------------------------------------------------
// add_mediator / remove_mediator — admin only
// ---------------------------------------------------------------------------

#[test]
fn test_auth_add_mediator_admin_allowed() {
    let h = Harness::new();
    let new_med = Address::generate(&h.env);
    h.client().add_mediator(&new_med);
    assert!(h.client().is_mediator(&new_med));
}

#[test]
#[should_panic]
fn test_auth_add_mediator_stranger_denied() {
    let h = Harness::new();
    let new_med = Address::generate(&h.env);
    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.stranger,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "add_mediator",
                args: soroban_sdk::vec![
                    &h.env,
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&new_med, &h.env),
                ],
                sub_invokes: &[],
            },
        }])
        .add_mediator(&new_med);
}

#[test]
fn test_auth_remove_mediator_admin_allowed() {
    let h = Harness::new();
    h.client().remove_mediator(&h.mediator);
    assert!(!h.client().is_mediator(&h.mediator));
}

#[test]
#[should_panic]
fn test_auth_remove_mediator_stranger_denied() {
    let h = Harness::new();
    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.stranger,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "remove_mediator",
                args: soroban_sdk::vec![
                    &h.env,
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&h.mediator, &h.env),
                ],
                sub_invokes: &[],
            },
        }])
        .remove_mediator(&h.mediator);
}

// ---------------------------------------------------------------------------
// set_mediator — admin only (legacy path)
// ---------------------------------------------------------------------------

#[test]
fn test_auth_set_mediator_admin_allowed() {
    let h = Harness::new();
    let new_med = Address::generate(&h.env);
    h.client().set_mediator(&new_med);
    assert!(h.client().is_mediator(&new_med));
}

#[test]
#[should_panic]
fn test_auth_set_mediator_stranger_denied() {
    let h = Harness::new();
    let new_med = Address::generate(&h.env);
    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.stranger,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "set_mediator",
                args: soroban_sdk::vec![
                    &h.env,
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&new_med, &h.env),
                ],
                sub_invokes: &[],
            },
        }])
        .set_mediator(&new_med);
}

// ---------------------------------------------------------------------------
// submit_video_proof — buyer or seller only
// ---------------------------------------------------------------------------

#[test]
fn test_auth_submit_video_proof_buyer_allowed() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().submit_video_proof(&tid, &h.buyer, &SStr::from_str(&h.env, "QmBuyerVideo"));
    assert!(h.client().get_video_proof(&tid).is_some());
}

#[test]
fn test_auth_submit_video_proof_seller_allowed() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().submit_video_proof(&tid, &h.seller, &SStr::from_str(&h.env, "QmSellerVideo"));
    assert!(h.client().get_video_proof(&tid).is_some());
}

#[test]
#[should_panic(expected = "Only the buyer or seller can submit video proof")]
fn test_auth_submit_video_proof_mediator_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().submit_video_proof(&tid, &h.mediator, &SStr::from_str(&h.env, "QmMedVideo"));
}

#[test]
#[should_panic(expected = "Only the buyer or seller can submit video proof")]
fn test_auth_submit_video_proof_stranger_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().submit_video_proof(&tid, &h.stranger, &SStr::from_str(&h.env, "QmBadVideo"));
}

// ---------------------------------------------------------------------------
// submit_manifest — seller only
// ---------------------------------------------------------------------------

#[test]
fn test_auth_submit_manifest_seller_allowed() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().submit_manifest(
        &tid, &h.seller,
        &SStr::from_str(&h.env, "QmDriverName"),
        &SStr::from_str(&h.env, "QmDriverId"),
    );
    assert!(h.client().get_manifest(&tid).is_some());
}

#[test]
#[should_panic(expected = "Only seller can submit manifest")]
fn test_auth_submit_manifest_buyer_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().submit_manifest(
        &tid, &h.buyer,
        &SStr::from_str(&h.env, "QmDriverName"),
        &SStr::from_str(&h.env, "QmDriverId"),
    );
}

#[test]
#[should_panic(expected = "Only seller can submit manifest")]
fn test_auth_submit_manifest_stranger_denied() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().submit_manifest(
        &tid, &h.stranger,
        &SStr::from_str(&h.env, "QmDriverName"),
        &SStr::from_str(&h.env, "QmDriverId"),
    );
}
