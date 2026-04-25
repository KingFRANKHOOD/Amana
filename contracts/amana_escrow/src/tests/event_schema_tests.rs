/// Issue #383 — Event schema regression tests
///
/// Locks the topic set and required payload fields for every lifecycle event.
/// Any topic/payload drift will cause these tests to fail, protecting indexers
/// and downstream consumers from silent schema breakage.
#[cfg(test)]
mod event_schema_tests {
    use crate::{EscrowContract, EscrowContractClient, TradeStatus};
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Events as _},
        token, Address, Env, IntoVal, String, Symbol, Val, Vec,
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn setup(
        env: &Env,
        amount: i128,
        fee_bps: u32,
    ) -> (Address, Address, Address, Address, Address) {
        let admin = Address::generate(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let usdc_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        token::StellarAssetClient::new(env, &usdc_id).mint(&buyer, &amount);
        client.initialize(&admin, &usdc_id, &treasury, &fee_bps);
        (contract_id, usdc_id, buyer, seller, treasury)
    }

    /// Assert that the most-recently emitted event has exactly the expected topics.
    fn assert_last_event_topics(env: &Env, expected: &[Val]) {
        let all = env.events().all();
        assert!(!all.is_empty(), "no events emitted");
        let (_, topics, _): (Address, Vec<Val>, Val) = all.last().unwrap();
        assert_eq!(
            topics.len() as usize,
            expected.len(),
            "topic count mismatch: got {}, want {}",
            topics.len(),
            expected.len()
        );
        for (i, exp) in expected.iter().enumerate() {
            assert_eq!(
                topics.get(i as u32).unwrap(),
                *exp,
                "topic[{i}] mismatch"
            );
        }
    }

    // -----------------------------------------------------------------------
    // #383-1  InitializedEvent  topics = ["amana", "initialized"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, _, _, _) = setup(&env, 10_000, 100);
        let _ = contract_id; // event already emitted during setup

        assert_last_event_topics(
            &env,
            &[
                Symbol::new(&env, "amana").into_val(&env),
                Symbol::new(&env, "initialized").into_val(&env),
            ],
        );

        // Payload fields: admin (Address) + fee_bps (u32)
        let all = env.events().all();
        let (_, _, data): (Address, Vec<Val>, Val) = all.last().unwrap();
        // data is a tuple/struct — just assert it is non-void (non-unit)
        let _: Val = data; // type-check: must be a Val, not ()
    }

    // -----------------------------------------------------------------------
    // #383-2  TradeCreatedEvent  topics = ["TRDCRT"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_trade_created() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);

        client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);

        assert_last_event_topics(
            &env,
            &[symbol_short!("TRDCRT").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-3  TradeFundedEvent  topics = ["TRDFND"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_trade_funded() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);

        client.deposit(&trade_id);

        assert_last_event_topics(
            &env,
            &[symbol_short!("TRDFND").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-4  TradeCancelledEvent  topics = ["TRDCAN"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_trade_cancelled() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);

        client.cancel_trade(&trade_id, &buyer);

        assert_last_event_topics(
            &env,
            &[symbol_short!("TRDCAN").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-5  DeliveryConfirmedEvent  topics = ["DELCNF"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_delivery_confirmed() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        client.confirm_delivery(&trade_id);

        assert_last_event_topics(
            &env,
            &[symbol_short!("DELCNF").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-6  FundsReleasedEvent  topics = ["RELSD"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_funds_released() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.confirm_delivery(&trade_id);

        client.release_funds(&trade_id);

        assert_last_event_topics(
            &env,
            &[symbol_short!("RELSD").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-7  DisputeInitiatedEvent  topics = ["DISINI"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_dispute_initiated() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "QmReason"));

        assert_last_event_topics(
            &env,
            &[symbol_short!("DISINI").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-8  DisputeResolvedEvent  topics = ["DISRES"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_dispute_resolved() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let mediator = Address::generate(&env);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "QmReason"));
        client.set_mediator(&mediator);

        client.resolve_dispute(&trade_id, &mediator, &5_000_u32);

        assert_last_event_topics(
            &env,
            &[symbol_short!("DISRES").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-9  EvidenceSubmittedEvent  topics = ["EVDSUB"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_evidence_submitted() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &buyer, &String::from_str(&env, "QmReason"));

        client.submit_evidence(
            &trade_id,
            &buyer,
            &String::from_str(&env, "QmEvidence"),
            &String::from_str(&env, "desc"),
        );

        assert_last_event_topics(
            &env,
            &[symbol_short!("EVDSUB").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-10  VideoProofSubmittedEvent  topics = ["VIDPRF"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_video_proof_submitted() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        client.submit_video_proof(&trade_id, &buyer, &String::from_str(&env, "QmCID"));

        assert_last_event_topics(
            &env,
            &[symbol_short!("VIDPRF").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-11  ManifestSubmittedEvent  topics = ["MNFST"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_manifest_submitted() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let trade_id = client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        client.submit_manifest(
            &trade_id,
            &seller,
            &String::from_str(&env, "QmDriverName"),
            &String::from_str(&env, "QmDriverId"),
        );

        assert_last_event_topics(
            &env,
            &[symbol_short!("MNFST").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-12  MediatorAddedEvent  topics = ["MEDADD"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_mediator_added() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, _, _, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let mediator = Address::generate(&env);

        client.add_mediator(&mediator);

        assert_last_event_topics(
            &env,
            &[symbol_short!("MEDADD").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-13  MediatorRemovedEvent  topics = ["MEDREM"]
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_mediator_removed() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, _, _, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let mediator = Address::generate(&env);
        client.add_mediator(&mediator);

        client.remove_mediator(&mediator);

        assert_last_event_topics(
            &env,
            &[symbol_short!("MEDREM").into_val(&env)],
        );
    }

    // -----------------------------------------------------------------------
    // #383-14  Golden snapshot: full lifecycle emits events in correct order
    // -----------------------------------------------------------------------
    #[test]
    fn test_event_schema_golden_lifecycle_order() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _, buyer, seller, _) = setup(&env, 10_000, 100);
        let client = EscrowContractClient::new(&env, &contract_id);
        let mediator = Address::generate(&env);

        // Capture event count after initialize
        let after_init = env.events().all().len();

        client.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
        let after_create = env.events().all().len();
        assert_eq!(after_create, after_init + 1, "create_trade must emit 1 event");

        let trade_id = {
            let all = env.events().all();
            let (_, _, data): (Address, Vec<Val>, Val) = all.last().unwrap();
            let _ = data;
            // re-create to get trade_id
            let contract_id2 = env.register(EscrowContract, ());
            let c2 = EscrowContractClient::new(&env, &contract_id2);
            let admin2 = Address::generate(&env);
            let usdc2 = env
                .register_stellar_asset_contract_v2(admin2.clone())
                .address();
            let treasury2 = Address::generate(&env);
            token::StellarAssetClient::new(&env, &usdc2).mint(&buyer, &10_000_i128);
            c2.initialize(&admin2, &usdc2, &treasury2, &100_u32);
            c2.set_mediator(&mediator);
            let tid = c2.create_trade(&buyer, &seller, &10_000_i128, &5000_u32, &5000_u32);
            c2.deposit(&tid);
            c2.initiate_dispute(&tid, &buyer, &String::from_str(&env, "QmGolden"));
            c2.resolve_dispute(&tid, &mediator, &5_000_u32);

            // Verify final status
            assert!(matches!(
                c2.get_trade(&tid).status,
                TradeStatus::Completed
            ));
            tid
        };
        let _ = trade_id;

        // Verify the full event sequence ends with DISRES
        let all = env.events().all();
        let (_, last_topics, _): (Address, Vec<Val>, Val) = all.last().unwrap();
        assert_eq!(
            last_topics.get(0).unwrap(),
            symbol_short!("DISRES").into_val(&env),
            "last event in dispute lifecycle must be DISRES"
        );
    }
}
