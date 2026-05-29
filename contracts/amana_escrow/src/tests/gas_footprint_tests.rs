/// Issue #388/#552/#544 — Gas and footprint regression checks for hot paths
///
/// Measures CPU instructions and memory bytes consumed by the escrow hot paths.
/// See `contracts/amana_escrow/docs/gas-estimation.md` for the methodology,
/// re-baselining policy, and CI assumptions.
#[cfg(test)]
mod gas_footprint_tests {
    use crate::{EscrowContract, EscrowContractClient};
    use soroban_sdk::{
        testutils::Address as _,
        token, Address, Env, String,
    };

    const BASELINE_CREATE_TRADE_CPU: u64 = 3_000_000;
    const BASELINE_CREATE_TRADE_MEM: u64 = 2_000_000;
    const BASELINE_DEPOSIT_CPU: u64 = 5_000_000;
    const BASELINE_DEPOSIT_MEM: u64 = 3_000_000;
    const BASELINE_DISPUTE_CPU: u64 = 3_000_000;
    const BASELINE_DISPUTE_MEM: u64 = 2_000_000;
    const BASELINE_RESOLVE_CPU: u64 = 8_000_000;
    const BASELINE_RESOLVE_MEM: u64 = 4_000_000;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct CostEstimate {
        cpu: u64,
        mem: u64,
    }

    impl CostEstimate {
        fn assert_under(self, label: &str, max_cpu: u64, max_mem: u64) {
            assert!(self.cpu > 0, "{label} CPU estimate must be non-zero");
            assert!(self.mem > 0, "{label} MEM estimate must be non-zero");
            assert!(self.cpu <= max_cpu, "{label} CPU regression: {} > baseline {max_cpu}", self.cpu);
            assert!(self.mem <= max_mem, "{label} MEM regression: {} > baseline {max_mem}", self.mem);
        }
    }

    struct Ctx {
        env: Env,
        contract_id: Address,
        buyer: Address,
        seller: Address,
        mediator: Address,
    }

    impl Ctx {
        fn new(amount: i128) -> Self {
            let env = Env::default();
            env.mock_all_auths();
            env.cost_estimate().budget().reset_unlimited();

            let admin = Address::generate(&env);
            let buyer = Address::generate(&env);
            let seller = Address::generate(&env);
            let treasury = Address::generate(&env);
            let mediator = Address::generate(&env);

            let contract_id = env.register(EscrowContract, ());
            let usdc_id = env.register_stellar_asset_contract_v2(admin.clone()).address();

            token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &(amount * 10));

            let client = EscrowContractClient::new(&env, &contract_id);
            client.initialize(&admin, &usdc_id, &treasury, &100_u32);
            client.set_mediator(&mediator);

            Ctx { env, contract_id, buyer, seller, mediator }
        }

        fn client(&self) -> EscrowContractClient<'_> {
            EscrowContractClient::new(&self.env, &self.contract_id)
        }

        fn measure<F: FnOnce()>(&self, f: F) -> CostEstimate {
            self.env.cost_estimate().budget().reset_unlimited();
            f();
            let budget = self.env.cost_estimate().budget();
            CostEstimate {
                cpu: budget.cpu_instruction_cost(),
                mem: budget.memory_bytes_cost(),
            }
        }
    }

    #[test]
    fn test_gas_create_trade() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();

        let cost = ctx.measure(|| {
            client.create_trade(&ctx.buyer, &ctx.seller, &10_000_i128, &5000_u32, &5000_u32);
        });

        cost.assert_under("create_trade", BASELINE_CREATE_TRADE_CPU, BASELINE_CREATE_TRADE_MEM);
    }

    #[test]
    fn test_gas_deposit() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();
        let trade_id = client.create_trade(&ctx.buyer, &ctx.seller, &10_000_i128, &5000_u32, &5000_u32);

        let cost = ctx.measure(|| {
            client.deposit(&trade_id);
        });

        cost.assert_under("deposit", BASELINE_DEPOSIT_CPU, BASELINE_DEPOSIT_MEM);
    }

    #[test]
    fn test_gas_initiate_dispute() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();
        let trade_id = client.create_trade(&ctx.buyer, &ctx.seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);

        let cost = ctx.measure(|| {
            client.initiate_dispute(
                &trade_id,
                &ctx.buyer,
                &String::from_str(&ctx.env, "QmGasTestReason"),
            );
        });

        cost.assert_under("initiate_dispute", BASELINE_DISPUTE_CPU, BASELINE_DISPUTE_MEM);
    }

    #[test]
    fn test_gas_resolve_dispute() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();
        let trade_id = client.create_trade(&ctx.buyer, &ctx.seller, &10_000_i128, &5000_u32, &5000_u32);
        client.deposit(&trade_id);
        client.initiate_dispute(&trade_id, &ctx.buyer, &String::from_str(&ctx.env, "QmGasTestReason"));

        let cost = ctx.measure(|| {
            client.resolve_dispute(&trade_id, &ctx.mediator, &5_000_u32);
        });

        cost.assert_under("resolve_dispute", BASELINE_RESOLVE_CPU, BASELINE_RESOLVE_MEM);
    }

    #[test]
    fn test_gas_full_dispute_lifecycle_combined() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();

        let cost = ctx.measure(|| {
            let trade_id = client.create_trade(&ctx.buyer, &ctx.seller, &10_000_i128, &5000_u32, &5000_u32);
            client.deposit(&trade_id);
            client.initiate_dispute(&trade_id, &ctx.buyer, &String::from_str(&ctx.env, "QmCombinedReason"));
            client.resolve_dispute(&trade_id, &ctx.mediator, &5_000_u32);
        });

        cost.assert_under(
            "combined lifecycle",
            BASELINE_CREATE_TRADE_CPU + BASELINE_DEPOSIT_CPU + BASELINE_DISPUTE_CPU + BASELINE_RESOLVE_CPU,
            BASELINE_CREATE_TRADE_MEM + BASELINE_DEPOSIT_MEM + BASELINE_DISPUTE_MEM + BASELINE_RESOLVE_MEM,
        );
    }
}
