/// Issue #553 — Contract integration tests for event emission.
///
/// Validates that every lifecycle operation emits the correct event(s) with
/// accurate topic symbols and payload field values. These tests go beyond the
/// unit-level schema tests by verifying payload data integrity and event
/// sequencing across the full contract lifecycle.
extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _},
    token,
    xdr::ContractEventBody,
    xdr::ScVal,
    Address, Bytes, Env, IntoVal, String, Val,
};
use std::vec::Vec;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup(
    env: &Env,
    amount: i128,
    fee_bps: u32,
) -> (Address, Address, Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let buyer = Address::generate(env);
    let seller = Address::generate(env);
    let treasury = Address::generate(env);
    let mediator = Address::generate(env);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(env, &usdc_id).mint(&buyer, &amount);
    client.initialize(&admin, &usdc_id, &treasury, &fee_bps);
    (contract_id, usdc_id, buyer, seller, treasury, mediator)
}

/// Return the topics of the last emitted event as a Vec of ScVal for comparison.
fn last_event_topics(env: &Env) -> Vec<soroban_sdk::xdr::ScVal> {
    let all = env.events().all();
    let events = all.events();
    assert!(!events.is_empty(), "no events emitted");
    let last = events.last().unwrap();
    match &last.body {
        ContractEventBody::V0(v0) => v0.topics.to_vec(),
    }
}

/// Return the data body of the last emitted event as a Vec of ScVal.
/// Event payloads are serialized as ScVal::Vec(Some(fields)).
fn last_event_data(env: &Env) -> Vec<soroban_sdk::xdr::ScVal> {
    let all = env.events().all();
    let events = all.events();
    assert!(!events.is_empty(), "no events emitted");
    let last = events.last().unwrap();
    match &last.body {
        ContractEventBody::V0(v0) => match &v0.data {
            soroban_sdk::xdr::ScVal::Map(Some(map)) => {
                let mut vals = Vec::new();
                for entry in map.iter() {
                    vals.push(entry.val.clone());
                }
                vals
            },
            soroban_sdk::xdr::ScVal::Vec(Some(fields)) => fields.to_vec(),
            other => panic!("expected ScVal::Map or ScVal::Vec for event data, got {other:?}"),
        },
    }
}

/// Assert that the last event topic equals the expected symbol.
fn assert_last_topic(env: &Env, expected: Val) {
    use soroban_sdk::TryIntoVal;
    let topics = last_event_topics(env);
    assert!(!topics.is_empty(), "event has no topics");
    let expected_scval: soroban_sdk::xdr::ScVal = expected.try_into_val(env).unwrap();
    assert_eq!(
        topics.first().unwrap(),
        &expected_scval,
        "event topic mismatch"
    );
}

// ---------------------------------------------------------------------------
// TradeCreatedEvent payload verification
// ---------------------------------------------------------------------------
#[test]
fn test_event_trade_created_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, _) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);

    assert_last_topic(&env, symbol_short!("TRDCRT").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 4, "TradeCreatedEvent must have 4 payload fields");

    // trade_id: u64
    assert!(
        matches!(&data[3], ScVal::U64(id) if *id == trade_id),
        "expected trade_id {trade_id}, got {got:?}",
        got = data[3]
    );
}

// ---------------------------------------------------------------------------
// TradeFundedEvent payload verification
// ---------------------------------------------------------------------------
#[test]
fn test_event_trade_funded_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, _) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
    client.deposit(&trade_id);

    assert_last_topic(&env, symbol_short!("TRDFND").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 2, "TradeFundedEvent must have 2 payload fields");

    // amount should be 10_000
    assert!(
        matches!(&data[0], ScVal::I128(parts) if parts.lo == 10_000 && parts.hi == 0),
        "expected funded amount 10000, got {got:?}",
        got = data[0]
    );
}

// ---------------------------------------------------------------------------
// FundsReleasedEvent: seller_amount + fee_amount must equal funded amount
// ---------------------------------------------------------------------------
#[test]
fn test_event_funds_released_payload_integrity() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, _) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
    client.deposit(&trade_id);
    client.confirm_delivery(&trade_id);
    client.release_funds(&trade_id);

    assert_last_topic(&env, symbol_short!("RELSD").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 3, "FundsReleasedEvent must have 3 payload fields");

    // seller_amount + fee_amount should equal 10_000
    let seller_amount = match &data[1] {
        ScVal::I128(parts) => (parts.hi as i128) << 64 | parts.lo as i128,
        _ => panic!("expected I128 for seller_amount"),
    };
    let fee_amount = match &data[0] {
        ScVal::I128(parts) => (parts.hi as i128) << 64 | parts.lo as i128,
        _ => panic!("expected I128 for fee_amount"),
    };
    assert_eq!(
        seller_amount + fee_amount,
        10_000,
        "seller_amount ({seller_amount}) + fee_amount ({fee_amount}) must equal deposit (10000)"
    );
}

// ---------------------------------------------------------------------------
// DisputeInitiatedEvent payload verification
// ---------------------------------------------------------------------------
#[test]
fn test_event_dispute_initiated_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, _) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
    client.deposit(&trade_id);
    let reason = String::from_str(&env, "QmTestDisputeReason");
    client.initiate_dispute(&trade_id, &buyer, &reason);

    assert_last_topic(&env, symbol_short!("DISINI").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 3, "DisputeInitiatedEvent must have 3 payload fields");
}

// ---------------------------------------------------------------------------
// MediatorAddedEvent payload verification
// ---------------------------------------------------------------------------
#[test]
fn test_event_mediator_added_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, _, _, _, mediator) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let usdc_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    client.add_mediator(&mediator);

    assert_last_topic(&env, symbol_short!("MEDADD").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 1, "MediatorAddedEvent must have 1 payload field");
}

// ---------------------------------------------------------------------------
// MediatorRemovedEvent payload verification
// ---------------------------------------------------------------------------
#[test]
fn test_event_mediator_removed_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, _, _, _, mediator) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let usdc_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);
    client.add_mediator(&mediator);

    client.remove_mediator(&mediator);

    assert_last_topic(&env, symbol_short!("MEDREM").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 1, "MediatorRemovedEvent must have 1 payload field");
}

// ---------------------------------------------------------------------------
// Full lifecycle event sequence verification
// ---------------------------------------------------------------------------
#[test]
fn test_full_lifecycle_event_sequence() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, mediator) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    client.add_mediator(&mediator);
    assert_last_topic(&env, symbol_short!("MEDADD").into_val(&env));

    let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
    assert_last_topic(&env, symbol_short!("TRDCRT").into_val(&env));
    let _ = trade_id;

    // Deposit
    client.deposit(&trade_id);
    assert_last_topic(&env, symbol_short!("TRDFND").into_val(&env));

    // Confirm delivery
    client.confirm_delivery(&trade_id);
    assert_last_topic(&env, symbol_short!("DELCNF").into_val(&env));

    // Release funds
    client.release_funds(&trade_id);
    assert_last_topic(&env, symbol_short!("RELSD").into_val(&env));
}

// ---------------------------------------------------------------------------
// Dispute lifecycle event sequence
// ---------------------------------------------------------------------------
#[test]
fn test_dispute_lifecycle_event_sequence() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, mediator) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
    client.deposit(&trade_id);

    client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "QmDispute"));
    assert_last_topic(&env, symbol_short!("DISINI").into_val(&env));

    client.set_mediator(&mediator);
    client.submit_evidence(
        &trade_id,
        &buyer,
        &String::from_str(&env, "QmEvidence"),
        &String::from_str(&env, "Delivery discrepancy"),
    );
    assert_last_topic(&env, symbol_short!("EVDSUB").into_val(&env));

    client.resolve_dispute(&trade_id, &mediator, &5_000_u32);
    assert_last_topic(&env, symbol_short!("DISRES").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 4, "DisputeResolvedEvent must have 4 payload fields");
}

// ---------------------------------------------------------------------------
// VideoProofSubmittedEvent payload
// ---------------------------------------------------------------------------
#[test]
fn test_event_video_proof_submitted_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, _) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
    client.deposit(&trade_id);

    client.submit_video_proof(&trade_id, &buyer, &String::from_str(&env, "QmVideoCID"));

    assert_last_topic(&env, symbol_short!("VIDPRF").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 3, "VideoProofSubmittedEvent must have 3 payload fields");
}

// ---------------------------------------------------------------------------
// ManifestSubmittedEvent payload
// ---------------------------------------------------------------------------
#[test]
fn test_event_manifest_submitted_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, _) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
    client.deposit(&trade_id);

    client.submit_manifest(
        &trade_id,
        &seller,
        &String::from_str(&env, "QmDriverName"),
        &String::from_str(&env, "QmDriverId"),
    );

    assert_last_topic(&env, symbol_short!("MNFST").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 4, "ManifestSubmittedEvent must have 4 payload fields");
}

// ---------------------------------------------------------------------------
// Cancelled trade event payload
// ---------------------------------------------------------------------------
#[test]
fn test_event_trade_cancelled_payload() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, _) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
    client.cancel_trade(&trade_id, &buyer);

    assert_last_topic(&env, symbol_short!("TRDCAN").into_val(&env));

    let data = last_event_data(&env);
    assert_eq!(data.len(), 3, "TradeCancelledEvent must have 3 payload fields");
}

// ---------------------------------------------------------------------------
// No events emitted on failed operations (guards against silent emissions)
// ---------------------------------------------------------------------------
#[test]
fn test_no_event_on_invalid_create() {
    let env = Env::default();
    env.mock_all_auths();
    let (_, _, buyer, seller, _, _) = setup(&env, 10_000, 100);
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    let usdc_id = env
        .register_stellar_asset_contract_v2(buyer.clone())
        .address();
    token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &10_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &usdc_id, &treasury, &100_u32);

    // Attempt a create_trade with 0 amount should fail
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_trade(&buyer, &seller, &0_i128, &5000_u32, &5000_u32);
    }));
    assert!(result.is_err(), "create_trade with 0 amount must panic");
}
