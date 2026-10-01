/// Tests for MAX_TRADE_VALUE constant and validation in create_trade()
///
/// Covers:
///   1. Zero-value trade is rejected
///   2. Trade at exactly MAX_TRADE_VALUE is accepted
///   3. Trade above MAX_TRADE_VALUE is rejected with "TradeValueTooLarge"
#[cfg(test)]
mod max_trade_value_tests {
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Address, Env, token};

    use crate::{EscrowContract, EscrowContractClient, MAX_TRADE_VALUE};

    fn setup_contract(env: &Env) -> (EscrowContractClient, Address, Address, Address) {
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();

        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &token_id, &treasury, &crate::MIN_FEE_BPS, &token_id);

        let token_client = token::StellarAssetClient::new(env, &token_id);
        // Mint enough for the maximum-value test
        token_client.mint(&buyer, &(MAX_TRADE_VALUE + 1));

        (client, buyer, seller, token_id)
    }

    #[test]
    #[should_panic(expected = "amount must be greater than zero")]
    fn test_zero_amount_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, buyer, seller, _) = setup_contract(&env);
        client.create_trade(&buyer, &seller, &0_i128, &5000_u32, &5000_u32, &None);
    }

    #[test]
    fn test_max_trade_value_is_accepted() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, buyer, seller, _) = setup_contract(&env);
        // Should not panic — exactly at the limit is allowed
        let trade_id =
            client.create_trade(&buyer, &seller, &MAX_TRADE_VALUE, &5000_u32, &5000_u32, &None);
        assert!(trade_id > 0);
    }

    #[test]
    #[should_panic(expected = "TradeValueTooLarge")]
    fn test_overflow_amount_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, buyer, seller, _) = setup_contract(&env);
        client.create_trade(
            &buyer,
            &seller,
            &(MAX_TRADE_VALUE + 1),
            &5000_u32,
            &5000_u32,
            &None,
        );
    }
}
