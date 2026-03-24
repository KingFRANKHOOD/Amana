#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol};

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
}
