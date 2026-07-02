extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use quickcheck::TestResult;
use quickcheck_macros::quickcheck;
use soroban_sdk::{Address, Env, String as SStr, testutils::Address as _, token};

struct FuzzEnv {
    env: Env,
    contract_id: Address,
    usdc_id: Address,
    #[allow(dead_code)]
    admin: Address,
    treasury: Address,
}

impl FuzzEnv {
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
            .initialize(&admin, &usdc_id, &treasury, &fee_bps, &usdc_id);
        FuzzEnv {
            env,
            contract_id,
            usdc_id,
            admin,
            treasury,
        }
    }

    fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.contract_id)
    }
}

fn valid_amount(raw: i64) -> i128 {
    (raw.unsigned_abs() as i128).clamp(1, 1_000_000_000)
}

fn valid_bps(raw: u32) -> u32 {
    raw % 10_001
}

fn valid_loss_pair(buyer_loss_bps: u32, _seller_loss_bps: u32) -> (u32, u32) {
    let blbps = valid_bps(buyer_loss_bps);
    let slbps = 10_000 - blbps;
    (blbps, slbps)
}

fn random_address(env: &Env) -> Address {
    Address::generate(env)
}

#[quickcheck]
fn prop_state_machine_random_ops(
    raw_amount: i64,
    raw_buyer_bps: u32,
    raw_seller_bps: u32,
    raw_fee_bps: u32,
    raw_op_seq: u64,
) -> TestResult {
    let amount = valid_amount(raw_amount);
    let fee_bps = valid_bps(raw_fee_bps);
    let (buyer_loss_bps, seller_loss_bps) = valid_loss_pair(raw_buyer_bps, raw_seller_bps);

    let fe = FuzzEnv::new(fee_bps);
    let client = fe.client();
    let buyer = random_address(&fe.env);
    let seller = random_address(&fe.env);
    let mediator = random_address(&fe.env);
    client.set_mediator(&mediator);

    token::StellarAssetClient::new(&fe.env, &fe.usdc_id).mint(&buyer, &(amount * 2));

    let trade_id = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_trade(
            &buyer,
            &seller,
            &amount,
            &buyer_loss_bps,
            &seller_loss_bps,
            &None,
        )
    })) {
        Ok(id) => id,
        Err(_) => return TestResult::discard(),
    };

    let ops = [
        ("deposit", raw_op_seq & 0x01 != 0),
        ("confirm_delivery", raw_op_seq & 0x02 != 0),
        ("release_funds", raw_op_seq & 0x04 != 0),
        ("initiate_dispute", raw_op_seq & 0x08 != 0),
        ("cancel_trade", raw_op_seq & 0x10 != 0),
        ("refund", raw_op_seq & 0x20 != 0),
    ];

    for (op_name, should_execute) in &ops {
        if !should_execute {
            continue;
        }

        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match *op_name {
            "deposit" => {
                if token::Client::new(&fe.env, &fe.usdc_id).balance(&buyer) >= amount {
                    client.deposit(&trade_id);
                }
            }
            "confirm_delivery" => {
                client.confirm_delivery(&trade_id);
            }
            "release_funds" => {
                client.release_funds(&trade_id, &buyer);
            }
            "initiate_dispute" => {
                client.initiate_dispute(
                    &trade_id,
                    &buyer,
                    &SStr::from_str(&fe.env, "QmFuzzReason"),
                );
            }
            "cancel_trade" => {
                client.cancel_trade(&trade_id, &buyer);
            }
            "refund" => {
                client.refund(&trade_id);
            }
            _ => {}
        }));
    }

    let final_trade = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.get_trade(&trade_id)
    })) {
        Ok(t) => t,
        Err(_) => return TestResult::discard(),
    };

    TestResult::from_bool(
        final_trade.amount == amount && final_trade.buyer == buyer && final_trade.seller == seller,
    )
}

#[quickcheck]
fn prop_fuzz_addresses_in_create_trade(raw_amount: i64, raw_fee_bps: u32) -> TestResult {
    let fe = FuzzEnv::new(valid_bps(raw_fee_bps));
    let client = fe.client();

    let addr_a = Address::generate(&fe.env);
    let addr_b = Address::generate(&fe.env);

    token::StellarAssetClient::new(&fe.env, &fe.usdc_id).mint(&addr_a, &1_000_000);

    let amount = valid_amount(raw_amount);

    let self_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_trade(&addr_a, &addr_a, &amount, &5000, &5000, &None);
    }));
    assert!(
        self_result.is_err(),
        "self-referencing addresses must be rejected"
    );

    let zero_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_trade(&addr_a, &addr_b, &0, &5000, &5000, &None);
    }));
    assert!(zero_result.is_err(), "zero amount must be rejected");

    let invalid_bps_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_trade(&addr_a, &addr_b, &amount, &3000, &3000, &None);
    }));
    assert!(
        invalid_bps_result.is_err(),
        "invalid loss bps sum must be rejected"
    );

    TestResult::passed()
}

#[quickcheck]
fn prop_storage_integrity_rapid_transitions(raw_amount: i64, raw_fee_bps: u32) -> TestResult {
    let fee_bps = valid_bps(raw_fee_bps);
    let amount = valid_amount(raw_amount);

    let fe = FuzzEnv::new(fee_bps);
    let client = fe.client();
    let buyer = Address::generate(&fe.env);
    let seller = Address::generate(&fe.env);
    let mediator = Address::generate(&fe.env);

    client.set_mediator(&mediator);
    token::StellarAssetClient::new(&fe.env, &fe.usdc_id).mint(&buyer, &(amount * 2));

    let trade_id = client.create_trade(&buyer, &seller, &amount, &5000, &5000, &None);
    assert_eq!(client.get_trade(&trade_id).status, TradeStatus::Created);

    client.deposit(&trade_id);
    assert_eq!(client.get_trade(&trade_id).status, TradeStatus::Funded);

    client.confirm_delivery(&trade_id);
    assert_eq!(client.get_trade(&trade_id).status, TradeStatus::Delivered);

    client.release_funds(&trade_id, &buyer);
    assert_eq!(client.get_trade(&trade_id).status, TradeStatus::Completed);

    let metrics = client.get_contract_metrics();
    assert!(metrics.0 >= 1);

    let seq = client.get_release_sequence(&trade_id);
    assert!(seq.funded_at.is_some());
    assert!(seq.released_at.is_some());

    TestResult::passed()
}

#[quickcheck]
fn prop_resolve_dispute_fuzz(
    raw_amount: i64,
    raw_seller_gets_bps: u32,
    raw_fee_bps: u32,
) -> TestResult {
    let amount = valid_amount(raw_amount);
    let seller_gets_bps = valid_bps(raw_seller_gets_bps);
    let fee_bps = valid_bps(raw_fee_bps);

    if !(1..=500).contains(&fee_bps) {
        return TestResult::discard();
    }

    let fe = FuzzEnv::new(fee_bps);
    let client = fe.client();
    let buyer = Address::generate(&fe.env);
    let seller = Address::generate(&fe.env);
    let mediator = Address::generate(&fe.env);

    client.set_mediator(&mediator);
    token::StellarAssetClient::new(&fe.env, &fe.usdc_id).mint(&buyer, &(amount * 2));

    let trade_id = client.create_trade(&buyer, &seller, &amount, &5000, &5000, &None);
    client.deposit(&trade_id);
    client.initiate_dispute(&trade_id, &buyer, &SStr::from_str(&fe.env, "QmFuzz"));
    client.resolve_dispute(&trade_id, &mediator, &seller_gets_bps);

    let tok = token::Client::new(&fe.env, &fe.usdc_id);
    let seller_bal = tok.balance(&seller);
    let buyer_bal = tok.balance(&buyer);
    let treasury_bal = tok.balance(&fe.treasury);

    TestResult::from_bool(
        seller_bal >= 0
            && buyer_bal >= 0
            && treasury_bal >= 0
            && seller_bal + buyer_bal + treasury_bal == amount,
    )
}

#[quickcheck]
fn prop_boundary_fuzz(raw_amount_seed: u64, raw_fee_bps: u32) -> TestResult {
    let base_amounts = [
        1i128,
        10,
        100,
        1000,
        10_000,
        100_000,
        1_000_000,
        10_000_000,
        100_000_000,
        1_000_000_000,
    ];
    let idx = (raw_amount_seed % 10) as usize;
    let multiplier = match raw_amount_seed / 10 {
        0 => 1i128,
        1 => 3,
        2 => 7,
        3 => 11,
        4 => 13,
        _ => 1,
    };
    let amount = base_amounts[idx] * multiplier;

    if amount <= 0 || amount > 1_000_000_000_000 {
        return TestResult::discard();
    }

    let fee_bps = valid_bps(raw_fee_bps);
    let fe = FuzzEnv::new(fee_bps);
    let client = fe.client();
    let buyer = Address::generate(&fe.env);
    let seller = Address::generate(&fe.env);
    let mediator = Address::generate(&fe.env);

    client.set_mediator(&mediator);
    token::StellarAssetClient::new(&fe.env, &fe.usdc_id).mint(&buyer, &(amount * 2));

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_trade(&buyer, &seller, &amount, &5000, &5000, &None)
    }));

    if let Ok(trade_id) = result {
        let deposit_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.deposit(&trade_id);
        }));
        if deposit_result.is_ok() {
            let dispute_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.initiate_dispute(&trade_id, &buyer, &SStr::from_str(&fe.env, "QmBoundary"));
            }));
            if dispute_result.is_ok() {
                let resolve_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.resolve_dispute(&trade_id, &mediator, &5000);
                }));
                if resolve_result.is_ok() {
                    let tok = token::Client::new(&fe.env, &fe.usdc_id);
                    let s = tok.balance(&seller);
                    let b = tok.balance(&buyer);
                    let f = tok.balance(&fe.treasury);
                    assert_eq!(
                        s + b + f,
                        amount,
                        "conservation violated for amount={amount}"
                    );
                }
            }
        }
    }

    TestResult::passed()
}

#[quickcheck]
fn prop_many_trades_rapid_creation(raw_count: u32, raw_fee_bps: u32) -> TestResult {
    let count = (raw_count % 50) + 1;
    let fee_bps = valid_bps(raw_fee_bps);

    let fe = FuzzEnv::new(fee_bps);
    let client = fe.client();
    let buyer = Address::generate(&fe.env);
    let seller = Address::generate(&fe.env);

    token::StellarAssetClient::new(&fe.env, &fe.usdc_id).mint(&buyer, &1_000_000_000);

    let mut trade_ids = std::vec::Vec::new();

    for _ in 0..count {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.create_trade(&buyer, &seller, &1000, &5000, &5000, &None)
        }));
        if let Ok(tid) = result {
            trade_ids.push(tid);
        }
    }

    let metrics = client.get_contract_metrics();
    assert_eq!(metrics.0 as usize, trade_ids.len());

    for tid in &trade_ids {
        let trade = client.get_trade(tid);
        assert_eq!(trade.amount, 1000);
        assert_eq!(trade.buyer, buyer);
        assert_eq!(trade.seller, seller);
    }

    TestResult::passed()
}
