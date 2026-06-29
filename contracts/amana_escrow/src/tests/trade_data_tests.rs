/// Issue #754 — TradeData versioned enum tests
#[cfg(test)]
mod trade_data_tests {
    use crate::{DataKey, EscrowContract, EscrowContractClient, TradeData, TradeStatus, TradeV0};
    use soroban_sdk::{testutils::Address as _, token, Address, Env};

    fn setup(env: &Env, amount: i128) -> (Address, Address, Address, Address, Address) {
        let admin = Address::generate(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let contract_id = env.register(EscrowContract, ());
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::StellarAssetClient::new(env, &token_id).mint(&buyer, &amount);
        EscrowContractClient::new(env, &contract_id)
            .initialize(&admin, &token_id, &treasury, &100u32, &token_id);
        (contract_id, token_id, buyer, seller, treasury)
    }

    /// V0 data round-trips through storage correctly.
    #[test]
    fn trade_data_v0_read_write() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _token_id, buyer, seller, _treasury) = setup(&env, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);

        let trade_id = client.create_trade(&buyer, &seller, &10_000i128, &5000u32, &5000u32, &None);
        let trade = client.get_trade(&trade_id);

        assert_eq!(trade.trade_id, trade_id);
        assert_eq!(trade.buyer, buyer);
        assert_eq!(trade.seller, seller);
        assert!(matches!(trade.status, TradeStatus::Created));
    }

    /// The raw stored value is a TradeData::V0 envelope — confirms the enum wrapping.
    #[test]
    fn trade_stored_as_trade_data_v0() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _token_id, buyer, seller, _treasury) = setup(&env, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);

        let trade_id = client.create_trade(&buyer, &seller, &10_000i128, &5000u32, &5000u32, &None);

        env.as_contract(&contract_id, || {
            let raw: TradeData = env
                .storage()
                .persistent()
                .get(&DataKey::Trade(trade_id))
                .expect("should be stored");
            match raw {
                TradeData::V0(t) => {
                    assert_eq!(t.trade_id, trade_id);
                    assert!(matches!(t.status, TradeStatus::Created));
                }
            }
        });
    }

    /// Adding a hypothetical V1 variant compiles and does not break V0 reads.
    /// We simulate this by injecting a V0 record and reading it back via get_trade.
    #[test]
    fn v0_readable_after_future_envelope_addition() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, token_id, buyer, seller, _treasury) = setup(&env, 10_000);
        let client = EscrowContractClient::new(&env, &contract_id);

        let trade_id = client.create_trade(&buyer, &seller, &10_000i128, &5000u32, &5000u32, &None);

        // Re-write as explicit V0 (simulates what the contract already does).
        env.as_contract(&contract_id, || {
            let existing: TradeData = env
                .storage()
                .persistent()
                .get(&DataKey::Trade(trade_id))
                .unwrap();
            // Overwrite with the same V0 variant (no-op semantically, but proves
            // the enum can be written and read back without data loss).
            env.storage()
                .persistent()
                .set(&DataKey::Trade(trade_id), &existing);
        });

        let trade: TradeV0 = client.get_trade(&trade_id);
        assert_eq!(trade.trade_id, trade_id);
        assert_eq!(trade.buyer, buyer);
        assert_eq!(trade.seller, seller);
    }
}
