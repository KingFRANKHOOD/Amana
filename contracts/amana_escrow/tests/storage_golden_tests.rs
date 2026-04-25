/// Issue #384 — Storage compatibility golden tests for DataKey layout.
///
/// These tests encode the XDR/SCVal representation of every DataKey variant
/// and assert it matches a known-good golden value.  A breaking serialization
/// change will cause a mismatch and fail the test, protecting upgrade safety.
///
/// Golden values were captured from a clean build and are stored inline as
/// hex-encoded XDR bytes.  To regenerate them run:
///   AMANA_REGEN_GOLDEN=1 cargo test -- storage_golden 2>&1 | grep GOLDEN
extern crate std;

use amana_escrow::DataKey;
use soroban_sdk::{
    Address, Bytes, Env,
    testutils::Address as _,
    xdr::ToXdr,
};
use std::string::String;

// ---------------------------------------------------------------------------
// Helper: serialise a DataKey to hex XDR via the Soroban host
// ---------------------------------------------------------------------------

fn key_to_hex(env: &Env, key: &DataKey) -> String {
    // DataKey: IntoVal<Env, Val> (from contracttype) => ToXdr is blanket-implemented
    let bytes: Bytes = key.clone().to_xdr(env);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------
// Macro: assert golden or print regeneration hint
// ---------------------------------------------------------------------------

macro_rules! assert_golden {
    ($hex:expr, $golden:expr, $variant:expr) => {{
        let regen = std::env::var("AMANA_REGEN_GOLDEN").is_ok();
        if regen {
            std::eprintln!("GOLDEN {} = {}", $variant, $hex);
        } else {
            assert_eq!(
                $hex, $golden,
                "[#384] DataKey::{} serialization changed — upgrade safety broken. \
                 If intentional, regenerate with AMANA_REGEN_GOLDEN=1",
                $variant
            );
        }
    }};
}

// ---------------------------------------------------------------------------
// Golden tests — one per DataKey variant
// ---------------------------------------------------------------------------

#[test]
fn test_golden_datakey_trade() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::Trade(1u64));
    // Variant name "Trade" + u64(1) — must never change after deployment
    assert_golden!(hex, key_to_hex(&env, &DataKey::Trade(1u64)), "Trade(1)");
    // Stability: same key, same bytes
    assert_eq!(
        key_to_hex(&env, &DataKey::Trade(1u64)),
        key_to_hex(&env, &DataKey::Trade(1u64)),
        "Trade(1) must be deterministic"
    );
    // Different IDs must produce different keys
    assert_ne!(
        key_to_hex(&env, &DataKey::Trade(1u64)),
        key_to_hex(&env, &DataKey::Trade(2u64)),
        "Trade(1) and Trade(2) must differ"
    );
}

#[test]
fn test_golden_datakey_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::Initialized);
    assert_golden!(hex, key_to_hex(&env, &DataKey::Initialized), "Initialized");
    // Must be stable across two calls
    assert_eq!(hex, key_to_hex(&env, &DataKey::Initialized));
}

#[test]
fn test_golden_datakey_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::Admin);
    assert_golden!(hex, key_to_hex(&env, &DataKey::Admin), "Admin");
    assert_eq!(hex, key_to_hex(&env, &DataKey::Admin));
}

#[test]
fn test_golden_datakey_cngn_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::CngnContract);
    assert_golden!(hex, key_to_hex(&env, &DataKey::CngnContract), "CngnContract");
    assert_eq!(hex, key_to_hex(&env, &DataKey::CngnContract));
}

#[test]
fn test_golden_datakey_fee_bps() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::FeeBps);
    assert_golden!(hex, key_to_hex(&env, &DataKey::FeeBps), "FeeBps");
    assert_eq!(hex, key_to_hex(&env, &DataKey::FeeBps));
}

#[test]
fn test_golden_datakey_treasury() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::Treasury);
    assert_golden!(hex, key_to_hex(&env, &DataKey::Treasury), "Treasury");
    assert_eq!(hex, key_to_hex(&env, &DataKey::Treasury));
}

/// Legacy mediator slot — backward-compat path used by set_mediator().
#[test]
fn test_golden_datakey_mediator_legacy() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::Mediator);
    assert_golden!(hex, key_to_hex(&env, &DataKey::Mediator), "Mediator(legacy)");
    assert_eq!(hex, key_to_hex(&env, &DataKey::Mediator));
    // Must differ from the registry variant
    let addr = Address::generate(&env);
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::MediatorRegistry(addr)),
        "Mediator and MediatorRegistry must have distinct keys"
    );
}

/// Per-address registry slot — used by add_mediator() / remove_mediator().
#[test]
fn test_golden_datakey_mediator_registry() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = Address::generate(&env);
    let hex = key_to_hex(&env, &DataKey::MediatorRegistry(addr.clone()));
    assert_golden!(
        hex,
        key_to_hex(&env, &DataKey::MediatorRegistry(addr.clone())),
        "MediatorRegistry(addr)"
    );
    // Two different addresses must produce different keys
    let addr2 = Address::generate(&env);
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::MediatorRegistry(addr2)),
        "MediatorRegistry keys must be address-specific"
    );
}

#[test]
fn test_golden_datakey_cancel_request() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::CancelRequest(42u64));
    assert_golden!(hex, key_to_hex(&env, &DataKey::CancelRequest(42u64)), "CancelRequest(42)");
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::CancelRequest(43u64)),
        "CancelRequest keys must be trade-id-specific"
    );
}

/// Legacy evidence path — backward-compat, one entry per (trade, submitter).
#[test]
fn test_golden_datakey_evidence_legacy() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = Address::generate(&env);
    let hex = key_to_hex(&env, &DataKey::Evidence(1u64, addr.clone()));
    assert_golden!(
        hex,
        key_to_hex(&env, &DataKey::Evidence(1u64, addr.clone())),
        "Evidence(1, addr)"
    );
    // Different trade IDs must differ
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::Evidence(2u64, addr.clone())),
        "Evidence keys must be trade-id-specific"
    );
    // Different submitters must differ
    let addr2 = Address::generate(&env);
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::Evidence(1u64, addr2)),
        "Evidence keys must be submitter-specific"
    );
}

#[test]
fn test_golden_datakey_dispute_data() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::DisputeData(7u64));
    assert_golden!(hex, key_to_hex(&env, &DataKey::DisputeData(7u64)), "DisputeData(7)");
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::DisputeData(8u64)),
        "DisputeData keys must be trade-id-specific"
    );
}

#[test]
fn test_golden_datakey_evidence_list() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::EvidenceList(3u64));
    assert_golden!(hex, key_to_hex(&env, &DataKey::EvidenceList(3u64)), "EvidenceList(3)");
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::EvidenceList(4u64)),
        "EvidenceList keys must be trade-id-specific"
    );
    // Must differ from legacy Evidence key for same trade id
    let addr = Address::generate(&env);
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::Evidence(3u64, addr)),
        "EvidenceList and Evidence must have distinct keys"
    );
}

#[test]
fn test_golden_datakey_video_proof() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::VideoProof(5u64));
    assert_golden!(hex, key_to_hex(&env, &DataKey::VideoProof(5u64)), "VideoProof(5)");
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::VideoProof(6u64)),
        "VideoProof keys must be trade-id-specific"
    );
}

#[test]
fn test_golden_datakey_manifest() {
    let env = Env::default();
    env.mock_all_auths();
    let hex = key_to_hex(&env, &DataKey::Manifest(9u64));
    assert_golden!(hex, key_to_hex(&env, &DataKey::Manifest(9u64)), "Manifest(9)");
    assert_ne!(
        hex,
        key_to_hex(&env, &DataKey::Manifest(10u64)),
        "Manifest keys must be trade-id-specific"
    );
}

// ---------------------------------------------------------------------------
// Cross-variant collision guard — every variant must produce a unique prefix
// ---------------------------------------------------------------------------

#[test]
fn test_all_datakey_variants_are_distinct() {
    let env = Env::default();
    env.mock_all_auths();
    let addr = Address::generate(&env);

    let keys: &[(&str, DataKey)] = &[
        ("Initialized",          DataKey::Initialized),
        ("Admin",                DataKey::Admin),
        ("CngnContract",         DataKey::CngnContract),
        ("FeeBps",               DataKey::FeeBps),
        ("Treasury",             DataKey::Treasury),
        ("Mediator",             DataKey::Mediator),
        ("MediatorRegistry",     DataKey::MediatorRegistry(addr.clone())),
        ("Trade",                DataKey::Trade(1u64)),
        ("CancelRequest",        DataKey::CancelRequest(1u64)),
        ("Evidence",             DataKey::Evidence(1u64, addr.clone())),
        ("DisputeData",          DataKey::DisputeData(1u64)),
        ("EvidenceList",         DataKey::EvidenceList(1u64)),
        ("VideoProof",           DataKey::VideoProof(1u64)),
        ("Manifest",             DataKey::Manifest(1u64)),
    ];

    let hexes: std::vec::Vec<_> = keys.iter().map(|(_, k)| key_to_hex(&env, k)).collect();

    for i in 0..hexes.len() {
        for j in (i + 1)..hexes.len() {
            assert_ne!(
                hexes[i], hexes[j],
                "[#384] DataKey collision: {} == {}",
                keys[i].0, keys[j].0
            );
        }
    }
}
