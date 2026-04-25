/// Issue #393 — Migration rehearsal tests for token-bound trades
///
/// Proves that:
///   1. Trades created before a new deployment retain their original token
///      settlement path after the contract is re-initialised (simulated migration).
///   2. The token field on an existing trade cannot be mutated in-place after
///      initialize has been called.
///   3. Attempting to call initialize a second time is rejected, preventing
///      accidental token switching on a live deployment.
///   4. A trade funded against token-A is settled against token-A even when
///      the contract's cNGN pointer would theoretically change.
#[cfg(test)]
mod migration_tests {
    use crate::{EscrowContract, EscrowContractClient, TradeStatus};
    use soroban_sdk::{
        testutils::{Address as _},
        token, Address, Env, String,
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Minimal setup: returns (contract_id, token_id, buyer, seller, treasury, admin).
    fn deploy(env: &Env, amount: i128, fee_bps: u32) -> (Address, Address, Address, Address, Address, Address) {
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
            .initialize(&admin, &token_id, &treasury, &fee_bps);
        (contract_id, token_id, buyer, seller, treasury, admin)
    }

    // -----------------------------------------------------------------------
    // #393-1  initialize cannot be called twice (no in-place token switching)
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "AlreadyInitialized")]
    fn test_initialize_rejects_second_call() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, _, _, _, admin) = deploy(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Attempt to re-initialise with a different token — must panic
        let new_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let new_treasury = Address::generate(&env);
        client.initialize(&admin, &new_token, &new_treasury, &50_u32);
    }

    // -----------------------------------------------------------------------
    // #393-2  Old trade retains original token after simulated migration
    //
    //   Scenario:
    //     - Deploy contract with token-A, create + fund a trade.
    //     - Simulate migration: deploy a *new* contract instance with token-B.
    //     - Confirm the old trade's `token` field still points to token-A.
    //     - Settle the old trade — funds flow through token-A, not token-B.
    // -----------------------------------------------------------------------
    #[test]
    fn test_old_trade_retains_original_token_after_migration() {
        let env = Env::default();
        env.mock_all_auths();

        // ── Old deployment (token-A) ────────────────────────────────────────
        let (old_contract, token_a, buyer, seller, treasury_a, admin_a) =
            deploy(&env, 10_000, 100);
        let old_client = EscrowContractClient::new(&env, &old_contract);

        let trade_id =
            old_client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        old_client.deposit(&trade_id);

        // Verify trade is bound to token-A
        let trade_before = old_client.get_trade(&trade_id);
        assert_eq!(
            trade_before.token, token_a,
            "trade must be bound to token-A before migration"
        );

        // ── Simulated migration: new contract with token-B ──────────────────
        let admin_b = Address::generate(&env);
        let token_b = env
            .register_stellar_asset_contract_v2(admin_b.clone())
            .address();
        let new_contract = env.register(EscrowContract, ());
        let treasury_b = Address::generate(&env);
        EscrowContractClient::new(&env, &new_contract)
            .initialize(&admin_b, &token_b, &treasury_b, &100_u32);

        // ── Old trade is unaffected by the new deployment ───────────────────
        let trade_after = old_client.get_trade(&trade_id);
        assert_eq!(
            trade_after.token, token_a,
            "old trade token must still be token-A after new deployment"
        );
        assert_ne!(
            trade_after.token, token_b,
            "old trade must NOT reference token-B"
        );

        // ── Settle old trade — token-A balances must change ─────────────────
        old_client.confirm_delivery(&trade_id);
        old_client.release_funds(&trade_id);

        let tok_a = token::Client::new(&env, &token_a);
        let tok_b = token::Client::new(&env, &token_b);

        // Seller received token-A (minus 1% fee)
        assert_eq!(tok_a.balance(&seller), 9_900, "seller must receive token-A");
        assert_eq!(tok_a.balance(&treasury_a), 100, "treasury must receive token-A fee");

        // token-B balances are untouched
        assert_eq!(tok_b.balance(&seller), 0, "seller must have zero token-B");
        assert_eq!(tok_b.balance(&treasury_b), 0, "treasury-B must have zero token-B");

        assert!(matches!(
            old_client.get_trade(&trade_id).status,
            TradeStatus::Completed
        ));

        let _ = (admin_a, admin_b); // suppress unused warnings
    }

    // -----------------------------------------------------------------------
    // #393-3  Dispute on old trade settles via original token
    // -----------------------------------------------------------------------
    #[test]
    fn test_dispute_on_old_trade_settles_via_original_token() {
        let env = Env::default();
        env.mock_all_auths();

        let (old_contract, token_a, buyer, seller, treasury_a, _admin_a) =
            deploy(&env, 10_000, 100);
        let old_client = EscrowContractClient::new(&env, &old_contract);
        let mediator = Address::generate(&env);
        old_client.set_mediator(&mediator);

        let trade_id =
            old_client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        old_client.deposit(&trade_id);
        old_client.initiate_dispute(
            &trade_id,
            &buyer,
            &String::from_str(&env, "QmMigrationDisputeReason"),
        );

        // Simulate new deployment (different token) — old trade unaffected
        let admin_b = Address::generate(&env);
        let token_b = env
            .register_stellar_asset_contract_v2(admin_b.clone())
            .address();
        let new_contract = env.register(EscrowContract, ());
        EscrowContractClient::new(&env, &new_contract).initialize(
            &admin_b,
            &token_b,
            &Address::generate(&env),
            &100_u32,
        );

        // Resolve old dispute — must use token-A
        old_client.resolve_dispute(&trade_id, &mediator, &5_000_u32);

        let tok_a = token::Client::new(&env, &token_a);
        let tok_b = token::Client::new(&env, &token_b);

        // Funds distributed in token-A
        assert!(tok_a.balance(&seller) > 0, "seller must receive token-A");
        assert!(tok_a.balance(&treasury_a) > 0, "treasury must receive token-A fee");
        assert_eq!(tok_b.balance(&seller), 0, "seller must have zero token-B");

        assert!(matches!(
            old_client.get_trade(&trade_id).status,
            TradeStatus::Completed
        ));
    }

    // -----------------------------------------------------------------------
    // #393-4  Multiple pre-migration trades all settle via their original token
    // -----------------------------------------------------------------------
    #[test]
    fn test_multiple_pre_migration_trades_settle_via_original_token() {
        let env = Env::default();
        env.mock_all_auths();

        let (old_contract, token_a, buyer, seller, _treasury, _admin) =
            deploy(&env, 50_000, 0); // zero fee for simpler assertions
        let old_client = EscrowContractClient::new(&env, &old_contract);

        // Create 3 trades before migration
        let amount = 10_000_i128;
        let t1 = old_client.create_trade(&buyer, &seller, &amount, &5000_u32, &5000_u32);
        let t2 = old_client.create_trade(&buyer, &seller, &amount, &3000_u32, &7000_u32);
        let t3 = old_client.create_trade(&buyer, &seller, &amount, &7000_u32, &3000_u32);

        old_client.deposit(&t1);
        old_client.deposit(&t2);
        old_client.deposit(&t3);

        // Simulate migration
        let admin_b = Address::generate(&env);
        let token_b = env
            .register_stellar_asset_contract_v2(admin_b.clone())
            .address();
        let new_contract = env.register(EscrowContract, ());
        EscrowContractClient::new(&env, &new_contract).initialize(
            &admin_b,
            &token_b,
            &Address::generate(&env),
            &100_u32,
        );

        // All three old trades still reference token-A
        for tid in [t1, t2, t3] {
            assert_eq!(
                old_client.get_trade(&tid).token,
                token_a,
                "trade {tid} must still reference token-A after migration"
            );
        }

        // Settle all three via the happy path
        old_client.confirm_delivery(&t1);
        old_client.release_funds(&t1);
        old_client.confirm_delivery(&t2);
        old_client.release_funds(&t2);
        old_client.confirm_delivery(&t3);
        old_client.release_funds(&t3);

        let tok_b = token::Client::new(&env, &token_b);
        // token-B must be completely untouched
        assert_eq!(tok_b.balance(&seller), 0, "seller must have zero token-B");
        assert_eq!(tok_b.balance(&buyer), 0, "buyer must have zero token-B");
    }

    // -----------------------------------------------------------------------
    // #393-5  Token field on a stored trade is immutable (read-only after creation)
    // -----------------------------------------------------------------------
    #[test]
    fn test_trade_token_field_is_immutable_after_creation() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, token_a, buyer, seller, _, _) = deploy(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        let trade_id =
            client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);

        let token_at_creation = client.get_trade(&trade_id).token.clone();

        // Advance through the lifecycle — token must never change
        client.deposit(&trade_id);
        assert_eq!(
            client.get_trade(&trade_id).token,
            token_at_creation,
            "token must be unchanged after deposit"
        );

        client.confirm_delivery(&trade_id);
        assert_eq!(
            client.get_trade(&trade_id).token,
            token_at_creation,
            "token must be unchanged after confirm_delivery"
        );

        client.release_funds(&trade_id);
        assert_eq!(
            client.get_trade(&trade_id).token,
            token_at_creation,
            "token must be unchanged after release_funds"
        );

        assert_eq!(token_at_creation, token_a);
    }
}
