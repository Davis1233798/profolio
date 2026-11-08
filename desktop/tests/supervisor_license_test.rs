#[path = "../src/license.rs"]
mod license;

use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn test_rust_license_validation_and_tamper_resistance() {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();

    // 1. Valid Active License
    let active_payload = license::LicensePayload {
        id: "LIC-TEST-RUST-01".to_string(),
        customer: "台灣先進智能製造股份有限公司".to_string(),
        contact: "security@manufacturing.tw".to_string(),
        hwid: "ANY".to_string(),
        modules: vec!["mes".to_string(), "erp".to_string(), "crm".to_string()],
        issued_at: now - 3600,
        expires_at: now + 86400 * 30,
        tier: "enterprise_pro".to_string(),
    };

    let key = license::sign_license(&active_payload, license::DEFAULT_MASTER_SECRET)
        .expect("Signing license failed");
    assert!(key.starts_with("BSLIC-V1-"));

    let verified = license::verify_license(&key, license::DEFAULT_MASTER_SECRET)
        .expect("Verification should succeed for valid key");
    assert_eq!(verified.customer, "台灣先進智能製造股份有限公司");
    assert!(!verified.is_expired(now));
    assert!(verified.allows_module("mes"));
    assert!(verified.allows_module("erp"));
    assert!(verified.allows_module("crm"));
    assert!(!verified.allows_module("dining"));

    // 2. Expired License
    let expired_payload = license::LicensePayload {
        id: "LIC-EXPIRED-01".to_string(),
        customer: "過期科技股份有限公司".to_string(),
        contact: "expired@test.com".to_string(),
        hwid: "ANY".to_string(),
        modules: vec!["all".to_string()],
        issued_at: now - 86400 * 60,
        expires_at: now - 86400, // yesterday
        tier: "enterprise_expired".to_string(),
    };
    let expired_key = license::sign_license(&expired_payload, license::DEFAULT_MASTER_SECRET)
        .expect("Signing expired license failed");
    let verified_exp = license::verify_license(&expired_key, license::DEFAULT_MASTER_SECRET)
        .expect("Verification of structure should succeed");
    assert!(verified_exp.is_expired(now));

    // 3. Tampered Key Detection
    let mut tampered = key.clone();
    tampered.push('a');
    assert!(license::verify_license(&tampered, license::DEFAULT_MASTER_SECRET).is_err());
}
