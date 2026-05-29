//! Issue #559 — Storage-layout refinement for future feature expansion.
//!
//! A persistent schema-version marker is written at `initialize()` and read via
//! `get_schema_version()`, giving future upgrades a stable signal to branch on
//! before migrating storage. These tests pin the version that ships today and
//! verify the backward-compatible default for instances that predate the marker.
extern crate std;

use amana_escrow::{CURRENT_SCHEMA_VERSION, DataKey, EscrowContract, EscrowContractClient};
use soroban_sdk::{Address, Env, testutils::Address as _};

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let escrow = env.register(EscrowContract, ());
    let admin = Address::generate(&env);
    let cngn = Address::generate(&env);
    let treasury = Address::generate(&env);
    EscrowContractClient::new(&env, &escrow).initialize(&admin, &cngn, &treasury, &100u32);
    (env, escrow)
}

#[test]
fn schema_version_is_recorded_on_initialize() {
    let (env, escrow) = setup();
    let client = EscrowContractClient::new(&env, &escrow);
    assert_eq!(client.get_schema_version(), CURRENT_SCHEMA_VERSION);
    assert_eq!(client.get_schema_version(), 1);
}

#[test]
fn schema_version_defaults_to_one_for_pre_versioning_instances() {
    let (env, escrow) = setup();
    // Simulate an instance deployed before schema versioning existed by clearing
    // the marker; the getter must still report the original layout (version 1).
    env.as_contract(&escrow, || {
        env.storage().instance().remove(&DataKey::SchemaVersion);
    });
    let client = EscrowContractClient::new(&env, &escrow);
    assert_eq!(client.get_schema_version(), 1);
}
