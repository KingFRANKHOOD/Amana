/// Tests that finalize_path_payment() enforces the same MIN_TRADE_AMOUNT /
/// MAX_TRADE_VALUE bounds as create_trade() on the swap output it assigns to
/// `trade.amount`.
#[cfg(test)]
mod path_payment_bounds_tests {
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, Vec, token, vec};

    use crate::{EscrowContract, EscrowContractClient, MAX_TRADE_VALUE, MIN_TRADE_AMOUNT, TradeStatus};

    fn setup(env: &Env) -> (EscrowContractClient<'_>, Address, Address, Address, Address) {
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let cngn_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let ngn_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::StellarAssetClient::new(env, &ngn_id).mint(&buyer, &MIN_TRADE_AMOUNT);
        client.initialize(&vec![env, admin.clone()], &1_u32, &cngn_id, &treasury, &100_u32, &ngn_id);
        (client, contract_id, buyer, seller, cngn_id)
    }

    /// Creates a trade, starts a path payment with `dest_min = 1`, and simulates
    /// the swap delivering `dest_amount` cNGN to the contract.
    fn start_path_payment(env: &Env, dest_amount: i128) -> (EscrowContractClient<'_>, u64, Address) {
        let (client, contract_id, buyer, seller, cngn_id) = setup(env);
        let trade_id =
            client.create_trade(&buyer, &seller, &MIN_TRADE_AMOUNT, &5000_u32, &5000_u32, &None);
        client.deposit_with_path(&trade_id, &buyer, &MIN_TRADE_AMOUNT, &1_i128, &Vec::new(env));
        token::StellarAssetClient::new(env, &cngn_id).mint(&contract_id, &dest_amount);
        (client, trade_id, buyer)
    }

    #[test]
    #[should_panic(expected = "amount must be at least MIN_TRADE_AMOUNT")]
    fn test_finalize_rejects_dust_dest_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, trade_id, buyer) = start_path_payment(&env, MIN_TRADE_AMOUNT - 1);
        client.finalize_path_payment(&trade_id, &buyer);
    }

    #[test]
    #[should_panic(expected = "TradeValueTooLarge")]
    fn test_finalize_rejects_dest_amount_above_max() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, trade_id, buyer) = start_path_payment(&env, MAX_TRADE_VALUE + 1);
        client.finalize_path_payment(&trade_id, &buyer);
    }

    #[test]
    fn test_finalize_accepts_dest_amount_at_bounds() {
        for dest_amount in [MIN_TRADE_AMOUNT, MAX_TRADE_VALUE] {
            let env = Env::default();
            env.mock_all_auths();
            let (client, trade_id, buyer) = start_path_payment(&env, dest_amount);
            client.finalize_path_payment(&trade_id, &buyer);

            let trade = client.get_trade(&trade_id);
            assert_eq!(trade.amount, dest_amount);
            assert!(matches!(trade.status, TradeStatus::Funded));
        }
    }
}
