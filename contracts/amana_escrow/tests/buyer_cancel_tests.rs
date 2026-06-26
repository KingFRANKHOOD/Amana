extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use soroban_sdk::{
    Address, Env, IntoVal, Val, symbol_short,
    testutils::{Address as _, Events as _},
    token,
    xdr::ContractEventBody,
};

struct Harness {
    env: Env,
    contract_id: Address,
    usdc_id: Address,
    buyer: Address,
    seller: Address,
    stranger: Address,
}

impl Harness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let stranger = Address::generate(&env);
        let usdc_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin, &usdc_id, &treasury, &100u32, &usdc_id);

        Self {
            env,
            contract_id,
            usdc_id,
            buyer,
            seller,
            stranger,
        }
    }

    fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.contract_id)
    }

    fn create_trade(&self) -> u64 {
        self.client().create_trade(
            &self.buyer,
            &self.seller,
            &1_000i128,
            &5000u32,
            &5000u32,
            &None,
        )
    }

    fn mint(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.usdc_id).mint(to, &amount);
    }
}

#[test]
fn cancel_by_buyer_cancels_created_trade_and_emits_event() {
    let h = Harness::new();
    let trade_id = h.create_trade();

    h.client().cancel_by_buyer(&trade_id);

    let trade = h.client().get_trade(&trade_id);
    assert!(matches!(trade.status, TradeStatus::Cancelled));

    let events = h.env.events().all().events();
    let event = events.last().expect("cancel event should be emitted");
    match &event.body {
        ContractEventBody::V0(v0) => {
            assert_eq!(
                v0.topics.get(0).unwrap(),
                symbol_short!("TCNBYR").into_val(&h.env)
            );
            match &v0.data {
                soroban_sdk::xdr::ScVal::Vec(Some(payload)) => assert_eq!(payload.len(), 2),
                soroban_sdk::xdr::ScVal::Map(Some(payload)) => assert_eq!(payload.len(), 2),
                other => panic!("expected vec or map event payload, got {other:?}"),
            }
        },
    }
}

#[test]
#[should_panic(expected = "Trade must be in Created status")]
fn cancel_by_buyer_rejects_funded_trade() {
    let h = Harness::new();
    let trade_id = h.create_trade();
    h.mint(&h.buyer, 1_000);
    h.client().deposit(&trade_id);

    h.client().cancel_by_buyer(&trade_id);
}

#[test]
#[should_panic]
fn cancel_by_buyer_rejects_non_buyer_auth() {
    let h = Harness::new();
    let trade_id = h.create_trade();

    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.stranger,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "cancel_by_buyer",
                args: soroban_sdk::vec![
                    &h.env,
                    IntoVal::<Env, Val>::into_val(&trade_id, &h.env),
                ],
                sub_invokes: &[],
            },
        }])
        .cancel_by_buyer(&trade_id);
}
