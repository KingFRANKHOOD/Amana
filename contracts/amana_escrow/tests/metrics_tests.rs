extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient};
use soroban_sdk::{
    Address, Env, String as SorobanString,
    testutils::{Address as _, Ledger as _},
    token,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup_env(env: &Env, fee_bps: u32) -> (Address, Address, Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let buyer = Address::generate(env);
    let seller = Address::generate(env);
    let treasury = Address::generate(env);
    let mediator = Address::generate(env);
    let usdc_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(env, &contract_id);
    client.initialize(&admin, &usdc_id, &treasury, &fee_bps, &usdc_id);
    client.set_mediator(&mediator);
    (contract_id, usdc_id, buyer, seller, treasury, mediator)
}

fn create_and_fund(
    env: &Env,
    client: &EscrowContractClient<'_>,
    buyer: &Address,
    seller: &Address,
    amount: i128,
    usdc_id: &Address,
) -> u64 {
    token::StellarAssetClient::new(env, usdc_id).mint(buyer, &amount);
    let trade_id = client.create_trade(buyer, seller, &amount, &5000_u32, &5000_u32, &None);
    client.deposit(&trade_id);
    trade_id
}

fn dispute_trade(
    env: &Env,
    client: &EscrowContractClient<'_>,
    trade_id: u64,
    initiator: &Address,
) {
    let reason = SorobanString::from_str(env, "QmDisputeReason");
    client.initiate_dispute(&trade_id, initiator, &reason);
}

fn resolve_dispute(
    client: &EscrowContractClient<'_>,
    trade_id: u64,
    mediator: &Address,
    seller_gets_bps: u32,
) {
    client.resolve_dispute(&trade_id, mediator, &seller_gets_bps);
}

// ---------------------------------------------------------------------------
// Counter accuracy tests
// ---------------------------------------------------------------------------

/// Freshly initialized contract reports zero for all metrics.
#[test]
fn test_metrics_start_at_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _usdc_id, _buyer, _seller, _treasury, _mediator) =
        setup_env(&env, 100);
    let client = EscrowContractClient::new(&env, &contract_id);

    let (total_trades, total_disputes, total_resolved) = client.get_contract_metrics();
    assert_eq!(total_trades, 0, "total_trades should start at 0");
    assert_eq!(total_disputes, 0, "total_disputes should start at 0");
    assert_eq!(total_resolved, 0, "total_resolved should start at 0");
}

/// total_trades increments monotonically with each create_trade call.
#[test]
fn test_total_trades_increments_with_each_trade() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, usdc_id, buyer, seller, _treasury, _mediator) =
        setup_env(&env, 100);
    let client = EscrowContractClient::new(&env, &contract_id);

    assert_eq!(client.get_contract_metrics().0, 0);

    let _tid1 = create_and_fund(&env, &client, &buyer, &seller, 1_000, &usdc_id);
    assert_eq!(client.get_contract_metrics().0, 1);

    let buyer2 = Address::generate(&env);
    let seller2 = Address::generate(&env);
    let _tid2 = create_and_fund(&env, &client, &buyer2, &seller2, 2_000, &usdc_id);
    assert_eq!(client.get_contract_metrics().0, 2);

    let _tid3 = create_and_fund(&env, &client, &buyer2, &seller2, 3_000, &usdc_id);
    assert_eq!(client.get_contract_metrics().0, 3);
}

/// total_disputes increments with each initiate_dispute and is independent of trades.
#[test]
fn test_total_disputes_increments_with_each_dispute() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, usdc_id, buyer, seller, _treasury, _mediator) =
        setup_env(&env, 100);
    let client = EscrowContractClient::new(&env, &contract_id);

    let tid1 = create_and_fund(&env, &client, &buyer, &seller, 1_000, &usdc_id);
    assert_eq!(client.get_contract_metrics().1, 0);

    dispute_trade(&env, &client, tid1, &buyer);
    assert_eq!(client.get_contract_metrics().1, 1);

    let tid2 = create_and_fund(&env, &client, &buyer, &seller, 2_000, &usdc_id);
    dispute_trade(&env, &client, tid2, &seller);
    assert_eq!(client.get_contract_metrics().1, 2);
}

/// total_resolved increments with each resolve_dispute call.
#[test]
fn test_total_resolved_increments_with_each_resolution() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, usdc_id, buyer, seller, _treasury, mediator) =
        setup_env(&env, 100);
    let client = EscrowContractClient::new(&env, &contract_id);

    let tid1 = create_and_fund(&env, &client, &buyer, &seller, 1_000, &usdc_id);
    dispute_trade(&env, &client, tid1, &buyer);
    assert_eq!(client.get_contract_metrics().2, 0);

    resolve_dispute(&client, tid1, &mediator, 5_000);
    assert_eq!(client.get_contract_metrics().2, 1);

    let tid2 = create_and_fund(&env, &client, &buyer, &seller, 2_000, &usdc_id);
    dispute_trade(&env, &client, tid2, &seller);
    resolve_dispute(&client, tid2, &mediator, 7_000);
    assert_eq!(client.get_contract_metrics().2, 2);
}

/// Each metric is independent: trades affect only total_trades,
/// disputes affect only total_disputes, resolutions affect only total_resolved.
#[test]
fn test_metrics_are_independent() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, usdc_id, buyer, seller, _treasury, mediator) =
        setup_env(&env, 100);
    let client = EscrowContractClient::new(&env, &contract_id);

    // Create 3 trades
    let tid1 = create_and_fund(&env, &client, &buyer, &seller, 1_000, &usdc_id);
    let tid2 = create_and_fund(&env, &client, &buyer, &seller, 2_000, &usdc_id);
    let _tid3 = create_and_fund(&env, &client, &buyer, &seller, 3_000, &usdc_id);
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 3);
    assert_eq!(d, 0);
    assert_eq!(r, 0);

    // Dispute trades 1 and 2 (2 disputes)
    dispute_trade(&env, &client, tid1, &buyer);
    dispute_trade(&env, &client, tid2, &seller);
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 3);
    assert_eq!(d, 2);
    assert_eq!(r, 0);

    // Resolve trade 1 (1 resolution)
    resolve_dispute(&client, tid1, &mediator, 5_000);
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 3);
    assert_eq!(d, 2);
    assert_eq!(r, 1);

    // Resolve trade 2 (2 resolutions)
    resolve_dispute(&client, tid2, &mediator, 3_000);
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 3);
    assert_eq!(d, 2);
    assert_eq!(r, 2);
}

// ---------------------------------------------------------------------------
// Counter persistence tests
// ---------------------------------------------------------------------------

/// Counters persist across multiple operations (create + dispute + resolve).
#[test]
fn test_metrics_persist_across_operations() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, usdc_id, buyer, seller, _treasury, mediator) =
        setup_env(&env, 100);
    let client = EscrowContractClient::new(&env, &contract_id);

    // Round 1
    let tid1 = create_and_fund(&env, &client, &buyer, &seller, 1_000, &usdc_id);
    dispute_trade(&env, &client, tid1, &buyer);
    resolve_dispute(&client, tid1, &mediator, 5_000);
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 1);
    assert_eq!(d, 1);
    assert_eq!(r, 1);

    // Round 2
    let tid2 = create_and_fund(&env, &client, &buyer, &seller, 2_000, &usdc_id);
    let tid3 = create_and_fund(&env, &client, &buyer, &seller, 3_000, &usdc_id);
    dispute_trade(&env, &client, tid2, &seller);
    resolve_dispute(&client, tid2, &mediator, 8_000);
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 3);
    assert_eq!(d, 2);
    assert_eq!(r, 2);

    // Round 3
    dispute_trade(&env, &client, tid3, &buyer);
    resolve_dispute(&client, tid3, &mediator, 2_000);
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 3);
    assert_eq!(d, 3);
    assert_eq!(r, 3);
}

/// Counters survive when the contract instance TTL is refreshed.
/// This exercises that instance storage (used for counters) is correctly
/// bumped via bump_instance_ttl().
#[test]
fn test_metrics_survive_ttl_refresh() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, usdc_id, buyer, seller, _treasury, mediator) =
        setup_env(&env, 100);
    let client = EscrowContractClient::new(&env, &contract_id);

    // Perform operations, then advance ledger to test TTL refresh
    let tid1 = create_and_fund(&env, &client, &buyer, &seller, 1_000, &usdc_id);
    let _tid2 = create_and_fund(&env, &client, &buyer, &seller, 2_000, &usdc_id);
    dispute_trade(&env, &client, tid1, &buyer);
    resolve_dispute(&client, tid1, &mediator, 5_000);

    // Verify metrics
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 2);
    assert_eq!(d, 1);
    assert_eq!(r, 1);

    // Advance ledger far enough that TTL would have been refreshed by previous calls
    let current = env.ledger().sequence();
    env.ledger().set_sequence_number(current + 10_000);

    // Create another trade, which bumps instance TTL
    let tid3 = create_and_fund(&env, &client, &buyer, &seller, 3_000, &usdc_id);
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 3, "total_trades should persist after TTL refresh");
    assert_eq!(d, 1, "total_disputes should persist after TTL refresh");
    assert_eq!(r, 1, "total_resolved should persist after TTL refresh");

    // Operations after TTL refresh still increment correctly
    dispute_trade(&env, &client, tid3, &buyer);
    resolve_dispute(&client, tid3, &mediator, 5_000);
    let (t, d, r) = client.get_contract_metrics();
    assert_eq!(t, 3);
    assert_eq!(d, 2);
    assert_eq!(r, 2);
}
