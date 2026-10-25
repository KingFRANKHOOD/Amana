#![cfg(test)]

use soroban_sdk::{Address, Env, testutils::Address as _};

mod local_deployment_tests {
    use super::*;
    use amana_escrow::EscrowContractClient;

    /// Test that contract can be initialized with any token contract address
    /// (not just cNGN), supporting local network deployments with test tokens.
    #[test]
    fn test_initialize_with_arbitrary_token_contract() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(amana_escrow::EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let test_token = Address::generate(&env); // Arbitrary token for local testing
        let treasury = Address::generate(&env);

        // Should not panic — contract accepts any token address
        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &test_token, &treasury, &100_u32, &test_token);

        // Verify initialization succeeded
        let stored_token = client.get_token_contract();
        assert_eq!(stored_token, test_token);
    }

    /// Test that contract supports both legacy CngnContract and new SourceToken storage keys
    /// for backward compatibility with local network deployments.
    #[test]
    fn test_token_storage_key_compatibility() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(amana_escrow::EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token1 = Address::generate(&env);
        let token2 = Address::generate(&env);
        let treasury = Address::generate(&env);

        // Initialize with token1 as both cngn_contract and source_token
        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &token1, &treasury, &100_u32, &token2);

        // Verify both storage keys are accessible
        let cngn_token = client.get_token_contract();
        let source_token = client.get_source_token();

        assert_eq!(cngn_token, token1);
        assert_eq!(source_token, token2);
    }

    /// Test that contract initialization is idempotent and rejects re-initialization
    /// (critical for deployment safety on local networks).
    #[test]
    #[should_panic(expected = "AlreadyInitialized")]
    fn test_initialize_rejects_reinitialization() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(amana_escrow::EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let treasury = Address::generate(&env);

        // First initialization should succeed
        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &token, &treasury, &100_u32, &token);

        // Second initialization should panic
        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &token, &treasury, &100_u32, &token);
    }

    /// Test that admin authorization is enforced during initialization
    /// (critical security check for local network deployments).
    #[test]
    #[should_panic(expected = "HostError")]
    fn test_initialize_requires_admin_auth() {
        let env = Env::default();
        // Do NOT mock all auths — this tests that admin.require_auth() is enforced

        let contract_id = env.register(amana_escrow::EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let treasury = Address::generate(&env);

        // Should panic because admin auth is not mocked
        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &token, &treasury, &100_u32, &token);
    }

    /// Test that fee_bps validation works correctly for local deployments
    /// (prevents invalid configurations).
    #[test]
    #[should_panic(expected = "fee_bps out of range")]
    fn test_initialize_rejects_invalid_fee_bps() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(amana_escrow::EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let treasury = Address::generate(&env);

        // Should panic — fee_bps > 10000 is invalid
        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &token, &treasury, &(amana_escrow::MAX_FEE_BPS + 1), &token);
    }

    /// Test that contract state persists correctly after initialization
    /// (validates storage layer for local network deployments).
    #[test]
    fn test_contract_state_persistence_after_init() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(amana_escrow::EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let treasury = Address::generate(&env);
        let fee_bps = 250_u32;

        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &token, &treasury, &fee_bps, &token);

        // Verify all state is correctly stored
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_token_contract(), token);
        assert_eq!(client.get_treasury(), treasury);
        assert_eq!(client.get_fee_bps(), fee_bps);
    }

    /// Test that initialization rejects a fee below the documented minimum.
    #[test]
    #[should_panic(expected = "fee_bps out of range")]
    fn test_initialize_rejects_zero_fee_bps() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(amana_escrow::EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let treasury = Address::generate(&env);

        // Zero is below MIN_FEE_BPS and must be rejected.
        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &token, &treasury, &0_u32, &token);
    }

    #[test]
    fn test_initialize_accepts_minimum_fee_bps() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(amana_escrow::EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let treasury = Address::generate(&env);

        client.initialize(
            &soroban_sdk::Vec::from_array(&env, [admin.clone()]),
            &1_u32,
            &token,
            &treasury,
            &amana_escrow::MIN_FEE_BPS,
            &token,
        );

        assert_eq!(client.get_fee_bps(), amana_escrow::MIN_FEE_BPS);
    }

    /// Test that contract can be deployed with the maximum configured fee.
    #[test]
    fn test_initialize_with_max_fee_bps() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(amana_escrow::EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);
        let treasury = Address::generate(&env);

        // Should succeed — MAX_FEE_BPS is the maximum allowed.
        client.initialize(&soroban_sdk::Vec::from_array(&env, [admin.clone()]), &1_u32, &token, &treasury, &amana_escrow::MAX_FEE_BPS, &token);

        assert_eq!(client.get_fee_bps(), amana_escrow::MAX_FEE_BPS);
    }
}
