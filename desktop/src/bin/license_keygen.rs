use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "../license.rs"]
mod license;

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut customer = "台灣先進智能製造股份有限公司".to_string();
    let mut days: u64 = 365;
    let mut modules = vec![
        "erp".to_string(),
        "mes".to_string(),
        "crm".to_string(),
        "shop".to_string(),
        "pos".to_string(),
        "dining".to_string(),
    ];
    let mut tier = "enterprise_unlimited".to_string();
    let mut expired = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--customer" if i + 1 < args.len() => {
                customer = args[i + 1].clone();
                i += 2;
            }
            "--days" if i + 1 < args.len() => {
                days = args[i + 1].parse().unwrap_or(365);
                i += 2;
            }
            "--modules" if i + 1 < args.len() => {
                modules = args[i + 1].split(',').map(|s| s.trim().to_lowercase()).collect();
                i += 2;
            }
            "--tier" if i + 1 < args.len() => {
                tier = args[i + 1].clone();
                i += 2;
            }
            "--expired" => {
                expired = true;
                i += 1;
            }
            "--help" | "-h" => {
                println!("Business Suite 授權金鑰產生器 (License Key Generator)");
                println!("使用方式: license-keygen [選項]");
                println!("  --customer <名稱>   客戶公司名稱 (預設: 台灣先進智能製造股份有限公司)");
                println!("  --days <天數>       授權有效天數 (預設: 365)");
                println!("  --modules <清單>    已購模組，逗號分隔 (預設: erp,mes,crm,shop,pos,dining)");
                println!("  --tier <等級>       授權等級 (預設: enterprise_unlimited)");
                println!("  --expired           產生已過期金鑰 (測試用)");
                return;
            }
            _ => { i += 1; }
        }
    }

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let (issued_at, expires_at) = if expired {
        (now - 86400 * 30, now - 86400) // 昨天過期
    } else {
        (now, now + days * 86400)
    };

    let payload = license::LicensePayload {
        id: format!("LIC-{}-{}", now, rand::random::<u16>()),
        customer: customer.clone(),
        contact: format!("admin@{}.com", customer.replace(' ', "").to_lowercase()),
        hwid: "ANY".to_string(),
        modules: modules.clone(),
        issued_at,
        expires_at,
        tier: tier.clone(),
    };

    let key = license::sign_license(&payload, license::DEFAULT_MASTER_SECRET).expect("簽署授權金鑰失敗");

    println!("============================================================");
    println!("        BUSINESS SUITE 企業授權金鑰已成功生成               ");
    println!("============================================================");
    println!("授權識別碼 (ID): {}", payload.id);
    println!("授權客戶名稱:    {}", payload.customer);
    println!("授權等級 (Tier): {}", payload.tier);
    println!("已授權模組清單:  {:?}", payload.modules);
    println!("授權狀態:        {} (到期日 Unix: {})", if expired { "已過期 (EXPIRED)" } else { "有效中 (ACTIVE)" }, expires_at);
    println!("------------------------------------------------------------");
    println!("授權金鑰 (LICENSE KEY):");
    println!("{}", key);
    println!("============================================================");
}
