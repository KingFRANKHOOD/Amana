#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol};

const ADMIN: Symbol = symbol_short!("ADMIN");
const TREASURY: Symbol = symbol_short!("TREASURY");
const FEE_BPS: Symbol = symbol_short!("FEE_BPS");
const FUNDS_RELEASED: Symbol = symbol_short!("RELSD");
const DELIVERY_CONFIRMED: Symbol = symbol_short!("DELCNF");
const BPS_DIVISOR: i128 = 10_000;

#[derive(Clone)]
#[contracttype]
pub enum TradeStatus {
    Funded,
    Delivered,
    Completed,
}

#[derive(Clone)]
#[contracttype]
// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InitializedEvent {
    pub admin: Address,
    pub fee_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeCreatedEvent {
    pub trade_id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeFundedEvent {
    pub trade_id: u64,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeCancelledEvent {
    pub trade_id: u64,
    pub refund_amount: i128,
    pub caller: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryConfirmedEvent {
    pub trade_id: u64,
    pub delivered_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FundsReleasedEvent {
    pub trade_id: u64,
    pub seller_amount: i128,
    pub fee_amount: i128,
}

// ---------------------------------------------------------------------------
// Types & Storage
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TradeStatus {
    Created,
    Funded,
    Delivered,
    Completed,
    Disputed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Trade {
    pub trade_id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    pub status: TradeStatus,
    pub delivered_at: Option<u64>,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Trade(u64),
}

#[derive(Clone)]
#[contracttype]
pub struct FundsReleasedEvent {
    pub trade_id: u64,
    pub seller_amount: i128,
    pub fee_amount: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct DeliveryConfirmedEvent {
    pub trade_id: u64,
    pub delivered_at: u64,
}
    pub created_at: u64,
    pub updated_at: u64,
    pub funded_at: Option<u64>,
    pub delivered_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DataKey {
    Trade(u64),
    Initialized,
    Admin,
    UsdcContract,
    FeeBps,
    Treasury,
    CancelRequest(u64),
}

const NEXT_TRADE_ID: Symbol = symbol_short!("NXTTRD");
const BPS_DIVISOR: i128 = 10_000;

// ---------------------------------------------------------------------------
// Escrow Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn initialize(env: Env, admin: Address, treasury: Address, fee_bps: u32) {
        admin.require_auth();
        assert!(fee_bps <= BPS_DIVISOR as u32, "invalid fee_bps");
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TREASURY, &treasury);
        env.storage().instance().set(&FEE_BPS, &fee_bps);
    }

    pub fn create_trade(
        env: Env,
        trade_id: u64,
        buyer: Address,
        seller: Address,
        token: Address,
        amount: i128,
    ) {
        buyer.require_auth();
        assert!(amount > 0, "amount must be positive");
        let key = DataKey::Trade(trade_id);
        assert!(
            env.storage().persistent().get::<_, Trade>(&key).is_none(),
            "trade already exists"
        );
        env.storage().persistent().set(
            &key,
            &Trade {
                trade_id,
                buyer,
                seller,
                token,
                amount,
                status: TradeStatus::Funded,
                delivered_at: None,
            },
        );
    }

    /// Buyer confirms delivery, moving trade to Delivered state.
    pub fn confirm_delivery(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).unwrap();
        trade.buyer.require_auth();
        assert!(
            matches!(trade.status, TradeStatus::Funded),
            "trade must be funded"
        );
        let delivered_at = env.ledger().timestamp();
        trade.status = TradeStatus::Delivered;
        trade.delivered_at = Some(delivered_at);
        trade.updated_at = delivered_at;
        env.storage().persistent().set(&key, &trade);
        env.events().publish(
            (DELIVERY_CONFIRMED, trade_id),
            DeliveryConfirmedEvent {
                trade_id,
                delivered_at,
            },
        );
    }

    /// Release funds to the seller after delivery is confirmed.
    /// Only the buyer or admin may call this.
    pub fn release_funds(env: Env, caller: Address, trade_id: u64) {
        caller.require_auth();
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).unwrap();
        assert!(
            matches!(trade.status, TradeStatus::Delivered),
            "trade must be delivered"
        );

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("Admin not set"));
        assert!(
            caller == trade.buyer || caller == admin,
            "only buyer or admin can release"
        );

        let fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or_else(|| panic!("Fee not set"));
        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .unwrap_or_else(|| panic!("Treasury not set"));

        let fee_amount = trade.amount_usdc * fee_bps as i128 / BPS_DIVISOR;
        let seller_amount = trade.amount_usdc - fee_amount;

        let token_client = soroban_sdk::token::Client::new(&env, &trade.token);
        token_client.transfer(&env.current_contract_address(), &trade.seller, &seller_amount);
        token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);

        trade.status = TradeStatus::Completed;
        trade.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&key, &trade);

        env.events().publish(
            (FUNDS_RELEASED, trade_id),
            FundsReleasedEvent {
                trade_id,
                seller_amount,
                fee_amount,
            },
        );
    }

    // -----------------------------------------------------------------------
    // Read-only query functions
    // -----------------------------------------------------------------------

    /// Returns the full Trade struct for the given trade ID.
    #[allow(dead_code)]
    pub fn get_trade(env: Env, trade_id: u64) -> Trade {
        let key = DataKey::Trade(trade_id);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("Trade not found"))
    }

    /// Returns the current platform fee in basis points.
    #[allow(dead_code)]
    pub fn get_platform_fee(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or_else(|| panic!("Platform fee not set"))
    }

    /// Returns the current admin address.
    #[allow(dead_code)]
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("Admin not set"))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token, Address, Env,
    };

    // -----------------------------------------------------------------------
    // Mock token contract
    // -----------------------------------------------------------------------

    #[contract]
    struct MockTokenContract;

    #[derive(Clone)]
    #[contracttype]
    enum MockTokenDataKey {
        Balance(Address),
    }

    #[contractimpl]
    impl MockTokenContract {
        pub fn mint(env: Env, to: Address, amount: i128) {
            let key = MockTokenDataKey::Balance(to.clone());
            let current = env
                .storage()
                .persistent()
                .get::<_, i128>(&key)
                .unwrap_or(0);
            env.storage().persistent().set(&key, &(current + amount));
        }

        pub fn balance(env: Env, owner: Address) -> i128 {
            env.storage()
                .persistent()
                .get(&MockTokenDataKey::Balance(owner))
                .unwrap_or(0)
        }

        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            assert!(amount >= 0, "invalid amount");
            let from_key = MockTokenDataKey::Balance(from.clone());
            let to_key = MockTokenDataKey::Balance(to.clone());
            let from_balance = env
                .storage()
                .persistent()
                .get::<_, i128>(&from_key)
                .unwrap_or(0);
            assert!(from_balance >= amount, "insufficient balance");
            let to_balance = env
                .storage()
                .persistent()
                .get::<_, i128>(&to_key)
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&from_key, &(from_balance - amount));
            env.storage()
                .persistent()
                .set(&to_key, &(to_balance + amount));
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        (env, contract_id)
    }

    /// Set up a trade already in the Delivered state, ready for release_funds.
    fn setup_trade(
        env: &Env,
        amount: i128,
        fee_bps: u32,
    ) -> (Address, Address, Address, Address, u64) {
        let admin = Address::generate(env);
        let buyer = Address::generate(env);
        let seller = Address::generate(env);
        let treasury = Address::generate(env);
        let trade_id = 1_u64;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &escrow_id);
        let token_id = env.register(MockTokenContract, ());
        let token_client = MockTokenContractClient::new(env, &token_id);

        token_client.mint(&escrow_id, &amount);
        client.initialize(&admin, &treasury, &fee_bps);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.confirm_delivery(&trade_id);

        (escrow_id, token_id, seller, treasury, trade_id)
    }

    // -----------------------------------------------------------------------
    // Storage / data-structure tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_storage_structs() {
        let (env, contract_id) = setup();
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        let trade = Trade {
            trade_id: 1,
            buyer: buyer.clone(),
            seller: seller.clone(),
            token: Address::generate(&env),
            amount_usdc: 1000,
            status: TradeStatus::Created,
            created_at: 1234567890,
            updated_at: 1234567890,
            delivered_at: None,
        };

        let key = DataKey::Trade(1);
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(&key, &trade);
            let read_trade: Trade = env.storage().persistent().get(&key).unwrap();
            assert_eq!(read_trade.trade_id, 1);
            assert_eq!(read_trade.buyer, buyer);
            assert_eq!(read_trade.seller, seller);
            assert_eq!(read_trade.amount_usdc, 1000);
            assert_eq!(read_trade.status, TradeStatus::Created);
            assert_eq!(read_trade.created_at, 1234567890);
            assert_eq!(read_trade.updated_at, 1234567890);
        });
    }

    // -----------------------------------------------------------------------
    // Initialization tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_initialize_succeeds() {
        let (env, contract_id) = setup();
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let usdc = Address::generate(&env);
        let fee_bps: u32 = 100;

        client.initialize(&admin, &usdc, &fee_bps);

        env.as_contract(&contract_id, || {
            let stored_admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .unwrap();
            let stored_fee: u32 = env
                .storage()
                .instance()
                .get(&DataKey::FeeBps)
                .unwrap();
            let initialized: bool = env
                .storage()
                .instance()
                .get(&DataKey::Initialized)
                .unwrap();
            assert_eq!(stored_admin, admin);
            assert_eq!(stored_fee, 100);
            assert!(initialized);
        });
    }

    #[test]
    #[should_panic]
    fn test_initialize_fails_if_called_twice() {
        let (env, contract_id) = setup();
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let usdc = Address::generate(&env);

        client.initialize(&admin, &usdc, &100u32);
        client.initialize(&admin, &usdc, &100u32);
    }

    // -----------------------------------------------------------------------
    // Query function tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_trade_returns_correct_data() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        client.initialize(&admin, &treasury, &100u32);
        let trade_id = client.create_trade(&buyer, &seller, &amount);

        let trade = client.get_trade(&trade_id);
        assert_eq!(trade.trade_id, trade_id);
        assert_eq!(trade.amount_usdc, amount);
        assert!(matches!(trade.status, TradeStatus::Created));
    }

    #[test]
    #[should_panic(expected = "Trade not found")]
    fn test_get_trade_panics_on_invalid_id() {
        let env = Env::default();
        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        client.get_trade(&999);
    }

    #[test]
    fn test_get_platform_fee_returns_initialized_value() {
        let (env, contract_id) = setup();
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let usdc = Address::generate(&env);

        client.initialize(&admin, &usdc, &100u32);

        let fee = client.get_platform_fee();
        assert_eq!(fee, 100);
    }

    // -----------------------------------------------------------------------
    // Trade lifecycle tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_create_trade_returns_id() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);

        let trade_id = client.create_trade(&buyer, &seller, &10_000);
        assert!(trade_id > 0);
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Created));
    }

    #[test]
    #[should_panic(expected = "amount_usdc must be greater than zero")]
    fn test_create_trade_fails_on_zero_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        client.create_trade(&buyer, &seller, &0);
    }

    #[test]
    fn test_create_trade_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        let trade_id = client.create_trade(&buyer, &seller, &5_000);

        let events = env.events().all();
        assert!(events.len() > 0);
        let found = events.iter().any(|event| {
            let topic0: Symbol = event.0.get(0).unwrap();
            let topic1: u64 = event.0.get(1).unwrap();
            topic0 == TRADE_CREATED && topic1 == trade_id
        });
        assert!(found, "expected trade created event");
    }

    #[test]
    fn test_confirm_delivery_transitions_to_delivered() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 1_700_000_000);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let trade_id = 42_u64;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_id = env.register(MockTokenContract, ());
        let token_client = MockTokenContractClient::new(&env, &token_id);
        token_client.mint(&escrow_id, &amount);

        client.initialize(&admin, &treasury, &100);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.confirm_delivery(&trade_id);

        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Delivered));
        assert_eq!(trade.delivered_at, Some(1_700_000_000));
    }

    #[test]
    #[should_panic(expected = "trade must be funded")]
    fn test_confirm_delivery_fails_if_not_in_funded_state() {
        let env = Env::default();
        env.mock_all_auths();
    pub fn initialize(env: Env, admin: Address, usdc_contract: Address, treasury: Address, fee_bps: u32) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic!("AlreadyInitialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UsdcContract, &usdc_contract);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.events().publish(("amana", "initialized"), InitializedEvent { admin, fee_bps });
    }

    pub fn create_trade(env: Env, buyer: Address, seller: Address, amount: i128) -> u64 {
        assert!(amount > 0, "amount must be greater than zero");
        let next_id: u64 = env.storage().instance().get(&NEXT_TRADE_ID).unwrap_or(1_u64);
        let ledger_seq = env.ledger().sequence() as u64;
        let trade_id = (ledger_seq << 32) | next_id;
        env.storage().instance().set(&NEXT_TRADE_ID, &(next_id + 1));
        let usdc_address: Address = env.storage().instance().get(&DataKey::UsdcContract).expect("Not initialized");
        let now = env.ledger().timestamp();
        let trade = Trade {
            trade_id,
            buyer: buyer.clone(),
            seller: seller.clone(),
            token: usdc_address,
            amount,
            status: TradeStatus::Created,
            created_at: now,
            updated_at: now,
            funded_at: None,
            delivered_at: None,
        };
        env.storage().persistent().set(&DataKey::Trade(trade_id), &trade);
        env.events().publish((symbol_short!("TRDCRT"), trade_id), TradeCreatedEvent {
            trade_id, buyer, seller, amount
        });
        trade_id
    }

    pub fn deposit(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        assert!(matches!(trade.status, TradeStatus::Created), "Trade must be in Created status");
        trade.buyer.require_auth();
        let token_client = token::Client::new(&env, &trade.token);
        token_client.transfer(&trade.buyer, &env.current_contract_address(), &trade.amount);
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Funded;
        trade.funded_at = Some(now);
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
        env.events().publish((symbol_short!("TRDFND"), trade_id), TradeFundedEvent {
            trade_id, amount: trade.amount
        });
    }

    pub fn cancel_trade(env: Env, trade_id: u64, caller: Address) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");

        caller.require_auth();

        if matches!(trade.status, TradeStatus::Created) {
            // Either party or admin can cancel immediately when not funded
            assert!(caller == trade.buyer || caller == trade.seller || caller == admin, "Unauthorized caller");

            Self::execute_cancellation(&env, &mut trade, 0, caller);
        } else if matches!(trade.status, TradeStatus::Funded) {
            let amount = trade.amount;
            if caller == admin {
                // Admin override
                Self::execute_cancellation(&env, &mut trade, amount, admin);
            } else {
                // Must be buyer or seller agreement
                assert!(caller == trade.buyer || caller == trade.seller, "Unauthorized caller");

                let req_key = DataKey::CancelRequest(trade_id);
                // request.0 = buyer, request.1 = seller
                let mut requests: (bool, bool) = env.storage().persistent().get(&req_key).unwrap_or((false, false));

                if caller == trade.buyer {
                    requests.0 = true;
                } else if caller == trade.seller {
                    requests.1 = true;
                }

                if requests.0 && requests.1 {
                    // Both have agreed
                    Self::execute_cancellation(&env, &mut trade, amount, caller);
                    env.storage().persistent().remove(&req_key);
                } else {
                    // Record request and wait for other party
                    env.storage().persistent().set(&req_key, &requests);
                    trade.updated_at = env.ledger().timestamp();
                    env.storage().persistent().set(&key, &trade);
                }
            }
        } else {
            panic!("Cannot cancel trade in current status");
        }
    }

    fn execute_cancellation(env: &Env, trade: &mut Trade, refund_amount: i128, caller: Address) {
        if refund_amount > 0 {
            let token_client = token::Client::new(env, &trade.token);
            token_client.transfer(&env.current_contract_address(), &trade.buyer, &refund_amount);
        }

        trade.status = TradeStatus::Cancelled;
        trade.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&DataKey::Trade(trade.trade_id), trade);

        env.events().publish(
            (symbol_short!("TRDCAN"), trade.trade_id),
            TradeCancelledEvent {
                trade_id: trade.trade_id,
                refund_amount,
                caller,
            },
        );
    }

    pub fn confirm_delivery(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        trade.buyer.require_auth();
        assert!(matches!(trade.status, TradeStatus::Funded), "Trade must be funded");
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Delivered;
        trade.delivered_at = Some(now);
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
        env.events().publish((symbol_short!("DELCNF"), trade_id), DeliveryConfirmedEvent {
            trade_id, delivered_at: now
        });
    }

    pub fn release_funds(env: Env, trade_id: u64) {
        let key = DataKey::Trade(trade_id);
        let mut trade: Trade = env.storage().persistent().get(&key).expect("Trade not found");
        assert!(matches!(trade.status, TradeStatus::Delivered), "Trade must be delivered");
        trade.buyer.require_auth();
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).expect("Treasury not set");
        let fee_amount = (trade.amount * (fee_bps as i128)) / BPS_DIVISOR;
        let seller_amount = trade.amount - fee_amount;
        let token_client = token::Client::new(&env, &trade.token);
        token_client.transfer(&env.current_contract_address(), &trade.seller, &seller_amount);
        if fee_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);
        }
        let now = env.ledger().timestamp();
        trade.status = TradeStatus::Completed;
        trade.updated_at = now;
        env.storage().persistent().set(&key, &trade);
        env.events().publish((symbol_short!("RELSD"), trade_id), FundsReleasedEvent {
            trade_id, seller_amount, fee_amount
        });
    }

    pub fn get_trade(env: Env, trade_id: u64) -> Trade {
        let key = DataKey::Trade(trade_id);
        env.storage().persistent().get(&key).expect("Trade not found")
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};

    #[test]
    fn test_deposit_succeeds_and_transitions_to_funded() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        
        let trade_id = client.create_trade(&buyer, &seller, &amount);
        
        env.ledger().with_mut(|li| li.timestamp = 1000);
        client.deposit(&trade_id);
        
        let trade = client.get_trade(&trade_id);
        assert!(matches!(trade.status, TradeStatus::Funded));
        assert_eq!(trade.funded_at, Some(1000));
        
        let token_readonly = token::Client::new(&env, &usdc_id);
        assert_eq!(token_readonly.balance(&client.address), amount);
        assert_eq!(token_readonly.balance(&buyer), 0);
    }

    #[test]
    #[should_panic]
    fn test_deposit_fails_if_caller_is_not_buyer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let trade_id = client.create_trade(&buyer, &seller, &1000_i128);
        client.mock_auths(&[]).deposit(&trade_id);
    }

    #[test]
    #[should_panic(expected = "Trade must be in Created status")]
    fn test_deposit_fails_if_trade_already_funded() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &(amount * 2));
        
        let trade_id = client.create_trade(&buyer, &seller, &amount);
        client.deposit(&trade_id);
        client.deposit(&trade_id);
    }

    #[test]
    fn test_cancel_before_funding_succeeds_for_either_party() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        // 1. Buyer can cancel
        let trade_id_1 = client.create_trade(&buyer, &seller, &1000_i128);
        client.cancel_trade(&trade_id_1, &buyer);
        assert!(matches!(client.get_trade(&trade_id_1).status, TradeStatus::Cancelled));

        // 2. Seller can cancel
        let trade_id_2 = client.create_trade(&buyer, &seller, &1000_i128);
        client.cancel_trade(&trade_id_2, &seller);
        assert!(matches!(client.get_trade(&trade_id_2).status, TradeStatus::Cancelled));
    }

    #[test]
    fn test_cancel_after_funding_requires_both_parties() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        
        let trade_id = client.create_trade(&buyer, &seller, &amount);
        client.deposit(&trade_id);

        // Buyer requests cancel
        client.cancel_trade(&trade_id, &buyer);
        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Funded));

        // Seller requests cancel
        client.cancel_trade(&trade_id, &seller);
        assert!(matches!(client.get_trade(&trade_id).status, TradeStatus::Cancelled));
    }

    #[test]
    fn test_cancel_refunds_buyer_correctly() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let trade_id = 43_u64;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_id = env.register(MockTokenContract, ());
        let token_client = MockTokenContractClient::new(&env, &token_id);
        token_client.mint(&escrow_id, &amount);

        client.initialize(&admin, &treasury, &100);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.confirm_delivery(&trade_id);
    }

    #[test]
    fn test_release_sends_correct_amount_to_seller() {
        let env = Env::default();
        env.mock_all_auths();
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let amount = 5000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        
        let trade_id = client.create_trade(&buyer, &seller, &amount);
        client.deposit(&trade_id);

        // Verify contract holds funds
        let token_readonly = token::Client::new(&env, &usdc_id);
        assert_eq!(token_readonly.balance(&client.address), amount);

        // Cancel via both parties
        client.cancel_trade(&trade_id, &buyer);
        client.cancel_trade(&trade_id, &seller);

        // Verify refund
        assert_eq!(token_readonly.balance(&buyer), amount);
        assert_eq!(token_readonly.balance(&client.address), 0);
    }

    #[test]
    #[should_panic(expected = "Cannot cancel trade in current status")]
    fn test_cancel_fails_after_delivery_confirmed() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let trade_id = 44_u64;

        let escrow_buyer = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_client = MockTokenContractClient::new(&env, &token_id);

        client.initialize(&admin, &treasury, &100);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.confirm_delivery(&trade_id);
        client.confirm_delivery(&trade_id);
    }

    #[test]
    fn test_release_sends_correct_fee_to_treasury() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 50_000_i128;
        let fee_bps = 100_u32;
        let (escrow_id, token_id, _seller, treasury, trade_id) =
            setup_trade(&env, amount, fee_bps);

        let escrow_buyer = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_client = MockTokenContractClient::new(&env, &token_id);

        client.release_funds(&escrow_buyer, &trade_id);
        assert_eq!(token_client.balance(&treasury), 500);
    }

    #[test]
    #[should_panic(expected = "trade must be delivered")]
    fn test_release_fails_if_not_in_delivered_state() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let treasury = Address::generate(&env);
        let amount = 10_000_i128;
        let trade_id = 9_u64;

        let escrow_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_id = env.register(MockTokenContract, ());
        let token_client = MockTokenContractClient::new(&env, &token_id);
        token_client.mint(&escrow_id, &amount);

        client.initialize(&admin, &treasury, &100);
        client.create_trade(&trade_id, &buyer, &seller, &token_id, &amount);
        client.release_funds(&trade_id);
    }

    #[test]
    fn test_fee_calculation_rounds_correctly() {
        let env = Env::default();
        env.mock_all_auths();
        let amount = 101_i128;
        let fee_bps = 100_u32; // 1%
        let (escrow_id, token_id, seller, treasury, trade_id) =
            setup_trade(&env, amount, fee_bps);

        let escrow_buyer = Address::generate(&env);
        let client = EscrowContractClient::new(&env, &escrow_id);
        let token_client = MockTokenContractClient::new(&env, &token_id);

        client.release_funds(&escrow_buyer, &trade_id);

        assert_eq!(token_client.balance(&treasury), 1);
        assert_eq!(token_client.balance(&seller), 100);
        let usdc_id = env.register_stellar_asset_contract(admin.clone());
        client.initialize(&admin, &usdc_id, &treasury, &100);

        let amount = 1000_i128;
        let token_client = token::StellarAssetClient::new(&env, &usdc_id);
        token_client.mint(&buyer, &amount);
        
        let trade_id = client.create_trade(&buyer, &seller, &amount);
        client.deposit(&trade_id);
        client.confirm_delivery(&trade_id);

        client.cancel_trade(&trade_id, &buyer);
    }
}
