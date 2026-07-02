/// Issue #751 — update_fee_bps tests
#[cfg(test)]
#[allow(clippy::module_inception)]
mod fee_update_tests {
    use crate::{EscrowContract, EscrowContractClient, MAX_FEE_BPS, MIN_FEE_BPS};
    use soroban_sdk::{Address, Env, IntoVal, testutils::Address as _};

    fn setup(env: &Env) -> (Address, Address, Address) {
        let admin = Address::generate(env);
        let contract_id = env.register(EscrowContract, ());
        let token = Address::generate(env);
        let treasury = Address::generate(env);
        EscrowContractClient::new(env, &contract_id)
            .initialize(&admin, &token, &treasury, &100u32, &token);
        (contract_id, admin, token)
    }

    #[test]
    fn update_fee_bps_valid_updates() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _token) = setup(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.update_fee_bps(&MIN_FEE_BPS);
        client.update_fee_bps(&250u32);
        client.update_fee_bps(&MAX_FEE_BPS);
    }

    #[test]
    #[should_panic(expected = "fee_bps out of range")]
    fn update_fee_bps_rejects_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _token) = setup(&env);
        EscrowContractClient::new(&env, &contract_id).update_fee_bps(&0u32);
    }

    #[test]
    #[should_panic(expected = "fee_bps out of range")]
    fn update_fee_bps_rejects_above_max() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _token) = setup(&env);
        EscrowContractClient::new(&env, &contract_id).update_fee_bps(&(MAX_FEE_BPS + 1));
    }

    #[test]
    #[should_panic]
    fn update_fee_bps_rejects_non_admin() {
        let env = Env::default();
        let (contract_id, _admin, _token) = setup(&env);
        let stranger = Address::generate(&env);
        // Provide auth only for stranger — admin.require_auth() will fail
        EscrowContractClient::new(&env, &contract_id)
            .mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &stranger,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "update_fee_bps",
                    args: soroban_sdk::vec![
                        &env,
                        IntoVal::<Env, soroban_sdk::Val>::into_val(&250u32, &env),
                    ],
                    sub_invokes: &[],
                },
            }])
            .update_fee_bps(&250u32);
    }
}
