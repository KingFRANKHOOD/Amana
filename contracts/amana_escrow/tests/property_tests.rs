/// Issue #382 — Make property tests reproducible and time-bounded.
///
/// Seeds are printed on every run so a failing case can be replayed with:
///   AMANA_PROP_SEED=<seed> cargo test
///
/// Iteration count is controlled by AMANA_PROP_TESTS (default 64).
extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use soroban_sdk::{Address, Env, String as SStr, testutils::Address as _, token};
use std::env as stdenv;

// ---------------------------------------------------------------------------
// Seed / iteration helpers
// ---------------------------------------------------------------------------

fn get_seed() -> u64 {
    stdenv::var("AMANA_PROP_SEED")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| {
            // Derive a stable-ish seed from the wall clock so different CI runs
            // still vary, but the value is always printed for replay.
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(42)
        })
}

fn get_iterations() -> usize {
    stdenv::var("AMANA_PROP_TESTS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(64)
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

struct PropEnv {
    env: Env,
    contract_id: Address,
    usdc_id: Address,
    admin: Address,
    treasury: Address,
}

impl PropEnv {
    fn new(fee_bps: u32) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register(EscrowContract, ());
        EscrowContractClient::new(&env, &contract_id)
            .initialize(&admin, &usdc_id, &treasury, &fee_bps);
        PropEnv { env, contract_id, usdc_id, admin, treasury }
    }

    fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.contract_id)
    }

    fn resolve(
        &self,
        buyer_loss_bps: u32,
        seller_loss_bps: u32,
        seller_gets_bps: u32,
        amount: i128,
    ) -> (i128, i128, i128) {
        let buyer = Address::generate(&self.env);
        let seller = Address::generate(&self.env);
        let mediator = Address::generate(&self.env);
        let client = self.client();

        token::StellarAssetClient::new(&self.env, &self.usdc_id).mint(&buyer, &amount);
        let trade_id =
            client.create_trade(&buyer, &seller, &amount, &buyer_loss_bps, &seller_loss_bps);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &SStr::from_str(&self.env, "QmPropTest"));
        client.set_mediator(&mediator);
        client.resolve_dispute(&trade_id, &mediator, &seller_gets_bps);

        let tok = token::Client::new(&self.env, &self.usdc_id);
        (tok.balance(&seller), tok.balance(&buyer), tok.balance(&self.treasury))
    }
}

// ---------------------------------------------------------------------------
// Property: fund conservation  seller + buyer + fee == total
// ---------------------------------------------------------------------------

#[test]
fn test_prop_fund_conservation_seeded() {
    let seed = get_seed();
    let iters = get_iterations();
    std::eprintln!("[#382] fund_conservation seed={seed} iters={iters}  replay: AMANA_PROP_SEED={seed} AMANA_PROP_TESTS={iters} cargo test test_prop_fund_conservation_seeded");

    let mut rng = StdRng::seed_from_u64(seed);

    for case in 0..iters {
        let fee_bps = rng.gen_range(0u32..=1_000);
        let amount = rng.gen_range(1i128..=1_000_000);
        let buyer_loss_bps = rng.gen_range(0u32..=10_000);
        let seller_loss_bps = 10_000 - buyer_loss_bps;
        let seller_gets_bps = rng.gen_range(0u32..=10_000);

        let pe = PropEnv::new(fee_bps);
        let (s, b, f) = pe.resolve(buyer_loss_bps, seller_loss_bps, seller_gets_bps, amount);

        assert_eq!(
            s + b + f,
            amount,
            "[#382] fund_conservation FAILED  seed={seed} case={case} \
             fee_bps={fee_bps} amount={amount} buyer_loss_bps={buyer_loss_bps} \
             seller_gets_bps={seller_gets_bps}  replay: AMANA_PROP_SEED={seed}"
        );
    }
}

// ---------------------------------------------------------------------------
// Property: non-negativity  no payout component < 0
// ---------------------------------------------------------------------------

#[test]
fn test_prop_non_negativity_seeded() {
    let seed = get_seed();
    let iters = get_iterations();
    std::eprintln!("[#382] non_negativity seed={seed} iters={iters}");

    let mut rng = StdRng::seed_from_u64(seed);

    for case in 0..iters {
        let fee_bps = rng.gen_range(0u32..=10_000);
        let amount = rng.gen_range(1i128..=1_000_000);
        let buyer_loss_bps = rng.gen_range(0u32..=10_000);
        let seller_loss_bps = 10_000 - buyer_loss_bps;
        let seller_gets_bps = rng.gen_range(0u32..=10_000);

        let pe = PropEnv::new(fee_bps);
        let (s, b, f) = pe.resolve(buyer_loss_bps, seller_loss_bps, seller_gets_bps, amount);

        assert!(
            s >= 0 && b >= 0 && f >= 0,
            "[#382] non_negativity FAILED  seed={seed} case={case} \
             s={s} b={b} f={f}  replay: AMANA_PROP_SEED={seed}"
        );
    }
}

// ---------------------------------------------------------------------------
// Property: seller monotonicity  higher seller_gets_bps => seller payout non-decreasing
// ---------------------------------------------------------------------------

#[test]
fn test_prop_seller_monotonicity_seeded() {
    let seed = get_seed();
    let iters = get_iterations();
    std::eprintln!("[#382] seller_monotonicity seed={seed} iters={iters}");

    let mut rng = StdRng::seed_from_u64(seed);

    for case in 0..iters {
        let fee_bps = rng.gen_range(0u32..=1_000);
        let amount = rng.gen_range(100i128..=1_000_000);
        let buyer_loss_bps = rng.gen_range(0u32..=10_000);
        let seller_loss_bps = 10_000 - buyer_loss_bps;
        let sgb_lo = rng.gen_range(0u32..10_000);
        let sgb_hi = rng.gen_range(sgb_lo..=10_000);

        let pe_lo = PropEnv::new(fee_bps);
        let (s_lo, _, _) = pe_lo.resolve(buyer_loss_bps, seller_loss_bps, sgb_lo, amount);

        let pe_hi = PropEnv::new(fee_bps);
        let (s_hi, _, _) = pe_hi.resolve(buyer_loss_bps, seller_loss_bps, sgb_hi, amount);

        assert!(
            s_hi >= s_lo,
            "[#382] seller_monotonicity FAILED  seed={seed} case={case} \
             sgb_lo={sgb_lo} s_lo={s_lo} sgb_hi={sgb_hi} s_hi={s_hi}  \
             replay: AMANA_PROP_SEED={seed}"
        );
    }
}

// ---------------------------------------------------------------------------
// Property: invalid lifecycle transitions are always rejected
// ---------------------------------------------------------------------------

#[test]
fn test_prop_invalid_lifecycle_transitions_seeded() {
    let seed = get_seed();
    let iters = get_iterations();
    std::eprintln!("[#382] invalid_lifecycle seed={seed} iters={iters}");

    let mut rng = StdRng::seed_from_u64(seed);

    for case in 0..iters {
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
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin, &usdc_id, &treasury, &100u32);

        let amount = rng.gen_range(1i128..=100_000);
        token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &amount);
        let trade_id = client.create_trade(&buyer, &seller, &amount, &5000u32, &5000u32);
        client.deposit(&trade_id);

        // Attempting to deposit again must panic (trade is Funded, not Created)
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let env2 = Env::default();
            env2.mock_all_auths();
            let admin2 = Address::generate(&env2);
            let buyer2 = Address::generate(&env2);
            let seller2 = Address::generate(&env2);
            let treasury2 = Address::generate(&env2);
            let usdc2 = env2
                .register_stellar_asset_contract_v2(admin2.clone())
                .address();
            let cid2 = env2.register(EscrowContract, ());
            let c2 = EscrowContractClient::new(&env2, &cid2);
            c2.initialize(&admin2, &usdc2, &treasury2, &100u32);
            let amt2 = 1_000i128;
            token::StellarAssetClient::new(&env2, &usdc2).mint(&buyer2, &(amt2 * 2));
            let tid2 = c2.create_trade(&buyer2, &seller2, &amt2, &5000u32, &5000u32);
            c2.deposit(&tid2);
            c2.deposit(&tid2); // must panic
        }));

        assert!(
            result.is_err(),
            "[#382] invalid_lifecycle FAILED: double-deposit did not panic  \
             seed={seed} case={case}  replay: AMANA_PROP_SEED={seed}"
        );
    }
}
