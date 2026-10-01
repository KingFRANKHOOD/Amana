/// Tests that submit_evidence() persists exactly one value under
/// `DataKey::Evidence(trade_id, submitter)` — the IPFS hash as a `String` —
/// and that get_evidence() returns it.
#[cfg(test)]
mod evidence_storage_tests {
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String, token, vec};

    use crate::{DataKey, EscrowContract, EscrowContractClient, MIN_TRADE_AMOUNT};

    #[test]
    fn test_submit_evidence_stores_string_under_legacy_key() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &MIN_TRADE_AMOUNT);
        client.initialize(&vec![&env, admin.clone()], &1_u32, &token_id, &treasury, &100_u32, &token_id);

        let trade_id =
            client.create_trade(&buyer, &seller, &MIN_TRADE_AMOUNT, &5000_u32, &5000_u32, &None);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "QmReason"));

        let ipfs_hash = String::from_str(&env, "QmEvidence");
        client.submit_evidence(
            &trade_id,
            &buyer,
            &ipfs_hash,
            &String::from_str(&env, "desc"),
        );

        let stored: Option<String> = env.as_contract(&contract_id, || {
            env.storage()
                .persistent()
                .get(&DataKey::Evidence(trade_id, buyer.clone()))
        });
        assert_eq!(stored, Some(ipfs_hash.clone()));
        assert_eq!(client.get_evidence(&trade_id, &buyer), Some(ipfs_hash));
    }
}
