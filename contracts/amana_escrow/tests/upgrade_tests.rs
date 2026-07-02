extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use soroban_sdk::{Address, Env, testutils::Address as _};

struct Harness {
    env: Env,
    contract_id: Address,
    buyer: Address,
    seller: Address,
    #[allow(dead_code)]
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
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin, &token_id, &treasury, &100u32, &token_id);

        Self {
            env,
            contract_id,
            buyer,
            seller,
            stranger,
        }
    }

    fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.contract_id)
    }
}

#[test]
fn test_env_re_registration_preserves_trade_state_for_upgrade_compatibility() {
    let h = Harness::new();
    let trade_id = h
        .client()
        .create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32, &None);

    h.env.register_at(&h.contract_id, EscrowContract, ());

    let trade = h.client().get_trade(&trade_id);
    assert_eq!(trade.trade_id, trade_id);
    assert!(matches!(trade.status, TradeStatus::Created));
}
