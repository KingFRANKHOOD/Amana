extern crate std;

use amana_escrow::{EscrowContract, EscrowContractClient, TradeStatus};
use soroban_sdk::{
    Address, Env,
    testutils::{Address as _, Ledger},
    token,
};

struct H {
    env: Env,
    escrow: Address,
    token: Address,
    admin: Address,
    buyer: Address,
    seller: Address,
    stranger: Address,
}

impl H {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| {
            l.timestamp = 1_700_000_000;
            l.sequence_number = 100;
        });

        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let stranger = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let escrow = env.register(EscrowContract, ());

        H { env, escrow, token, admin, buyer, seller, stranger }
    }

    fn c(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }

    fn tok(&self) -> token::StellarAssetClient<'_> {
        token::StellarAssetClient::new(&self.env, &self.token)
    }

    fn token_balance(&self, addr: &Address) -> i128 {
        token::Client::new(&self.env, &self.token).balance(addr)
    }

    fn init(&self) {
        self.c()
            .initialize(&self.admin, &self.token, &self.admin, &0u32, &self.token);
    }

    fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }

    fn advance_time(&self, seconds: u64) {
        self.env.ledger().with_mut(|l| {
            l.timestamp += seconds;
        });
    }

    fn funded_trade_with_deadline(&self, amount: i128, deadline_offset: u64) -> u64 {
        let deadline = self.now() + deadline_offset;
        self.tok().mint(&self.buyer, &amount);
        let trade_id = self.c().create_trade(
            &self.buyer,
            &self.seller,
            &amount,
            &5000u32,
            &5000u32,
            &Some(deadline),
        );
        self.c().deposit(&trade_id);
        trade_id
    }

    fn funded_trade_no_deadline(&self, amount: i128) -> u64 {
        self.tok().mint(&self.buyer, &amount);
        let trade_id = self.c().create_trade(
            &self.buyer,
            &self.seller,
            &amount,
            &5000u32,
            &5000u32,
            &None,
        );
        self.c().deposit(&trade_id);
        trade_id
    }
}

#[test]
fn test_expiry_refund_buyer_after_deadline() {
    let h = H::new();
    h.init();

    let amount = 1_000_000i128;
    let trade_id = h.funded_trade_with_deadline(amount, 3600);

    h.advance_time(3601);

    let buyer_balance_before = h.token_balance(&h.buyer);
    h.c().claim_expiry_refund(&trade_id, &h.buyer);
    let buyer_balance_after = h.token_balance(&h.buyer);

    assert_eq!(
        buyer_balance_after - buyer_balance_before,
        amount,
        "buyer should receive full refund"
    );

    let trade = h.c().get_trade(&trade_id);
    assert!(
        matches!(trade.status, TradeStatus::Cancelled),
        "trade must be Cancelled after expiry refund"
    );
}

#[test]
fn test_expiry_refund_seller_after_deadline() {
    let h = H::new();
    h.init();

    let amount = 500_000i128;
    let trade_id = h.funded_trade_with_deadline(amount, 7200);

    h.advance_time(7201);

    let buyer_balance_before = h.token_balance(&h.buyer);
    h.c().claim_expiry_refund(&trade_id, &h.seller);
    let buyer_balance_after = h.token_balance(&h.buyer);

    assert_eq!(
        buyer_balance_after - buyer_balance_before,
        amount,
        "buyer should receive full refund even when seller triggers expiry"
    );

    let trade = h.c().get_trade(&trade_id);
    assert!(
        matches!(trade.status, TradeStatus::Cancelled),
        "trade must be Cancelled"
    );
}

#[test]
#[should_panic]
fn test_expiry_refund_rejected_before_deadline() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);

    h.advance_time(3599);
    h.c().claim_expiry_refund(&trade_id, &h.buyer);
}

#[test]
#[should_panic]
fn test_expiry_refund_rejected_no_deadline() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_no_deadline(100_000);
    h.c().claim_expiry_refund(&trade_id, &h.buyer);
}

#[test]
#[should_panic]
fn test_expiry_refund_rejected_stranger() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);
    h.advance_time(3601);
    h.c().claim_expiry_refund(&trade_id, &h.stranger);
}

#[test]
#[should_panic]
fn test_expiry_refund_rejected_delivered_status() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);
    h.c().confirm_delivery(&trade_id);

    h.advance_time(3601);
    h.c().claim_expiry_refund(&trade_id, &h.buyer);
}

#[test]
#[should_panic]
fn test_expiry_refund_rejected_disputed_status() {
    let h = H::new();
    h.init();

    let mediator = Address::generate(&h.env);
    h.c().set_mediator(&mediator);

    let trade_id = h.funded_trade_with_deadline(100_000, 3600);
    h.c().initiate_dispute(
        &trade_id,
        &h.buyer,
        &soroban_sdk::String::from_str(&h.env, "QmTest"),
    );

    h.advance_time(3601);
    h.c().claim_expiry_refund(&trade_id, &h.buyer);
}

#[test]
#[should_panic]
fn test_create_trade_rejects_past_deadline() {
    let h = H::new();
    h.init();

    let past_deadline = h.now() - 1;
    h.tok().mint(&h.buyer, &1_000_000);
    h.c().create_trade(
        &h.buyer,
        &h.seller,
        &1_000_000,
        &5000u32,
        &5000u32,
        &Some(past_deadline),
    );
}

#[test]
fn test_trade_stores_expires_at() {
    let h = H::new();
    h.init();

    let deadline = h.now() + 3600;
    h.tok().mint(&h.buyer, &100_000);
    let trade_id = h.c().create_trade(
        &h.buyer,
        &h.seller,
        &100_000,
        &5000u32,
        &5000u32,
        &Some(deadline),
    );

    let trade = h.c().get_trade(&trade_id);
    assert_eq!(trade.expires_at, Some(deadline));
}

#[test]
fn test_trade_no_deadline_stores_none() {
    let h = H::new();
    h.init();

    let trade_id = h.funded_trade_no_deadline(100_000);
    let trade = h.c().get_trade(&trade_id);
    assert_eq!(trade.expires_at, None);
}

#[test]
fn test_expiry_refund_at_exact_deadline() {
    let h = H::new();
    h.init();

    let amount = 200_000i128;
    let trade_id = h.funded_trade_with_deadline(amount, 3600);

    h.advance_time(3600);

    let buyer_before = h.token_balance(&h.buyer);
    h.c().claim_expiry_refund(&trade_id, &h.buyer);
    let buyer_after = h.token_balance(&h.buyer);

    assert_eq!(buyer_after - buyer_before, amount);
}
