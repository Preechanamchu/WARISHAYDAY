-- Migration: Member Management System for Super Admin
-- Database: Cloudflare D1 (SQLite)

-- 1. Members Table
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'SUSPENDED', 'DISABLED'
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_members_username ON members(username);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);

-- 2. Customer Tags Table (1 Member can have multiple Hay Day player tags)
CREATE TABLE IF NOT EXISTS customer_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    tag_name TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'DISABLED'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_tags_member_id ON customer_tags(member_id);
CREATE INDEX IF NOT EXISTS idx_customer_tags_tag ON customer_tags(tag);

-- 3. Wallets Table (1 Member = 1 Wallet, strictly single balance across all tags)
CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
    balance REAL NOT NULL DEFAULT 0.00,
    total_deposit REAL NOT NULL DEFAULT 0.00,
    total_spent REAL NOT NULL DEFAULT 0.00,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallets_member_id ON wallets(member_id);

-- 4. Wallet Transactions Ledger
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_code TEXT UNIQUE NOT NULL,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'DEPOSIT', 'PURCHASE', 'REFUND', 'ADJUSTMENT'
    amount REAL NOT NULL,
    balance_before REAL NOT NULL,
    balance_after REAL NOT NULL,
    reference TEXT,
    admin_id INTEGER,
    status TEXT NOT NULL DEFAULT 'COMPLETED', -- 'COMPLETED', 'PENDING', 'REJECTED'
    note TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_member_id ON wallet_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON wallet_transactions(type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at);

-- 5. Credit Deposit Requests (Slip verification)
CREATE TABLE IF NOT EXISTS credit_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deposit_code TEXT UNIQUE NOT NULL,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    slip_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
    admin_id INTEGER,
    approved_at TEXT,
    rejected_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_deposits_member_id ON credit_deposits(member_id);
CREATE INDEX IF NOT EXISTS idx_credit_deposits_status ON credit_deposits(status);
CREATE INDEX IF NOT EXISTS idx_credit_deposits_created_at ON credit_deposits(created_at);

-- 6. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    admin_name TEXT,
    action TEXT NOT NULL, -- e.g. 'ADJUST_CREDIT', 'APPROVE_DEPOSIT', 'REJECT_DEPOSIT', 'UPDATE_MEMBER_STATUS', 'ADD_TAG', 'DELETE_TAG'
    target_type TEXT NOT NULL, -- 'MEMBER', 'WALLET', 'TAG', 'DEPOSIT'
    target_id TEXT NOT NULL,
    before_val TEXT,
    after_val TEXT,
    reason TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- 7. Member Activities
CREATE TABLE IF NOT EXISTS member_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL, -- 'LOGIN', 'LOGOUT', 'REGISTER', 'ADD_TAG', 'REMOVE_TAG', 'ORDER', 'DEPOSIT', 'CHANGE_PASSWORD', 'ADMIN_EDIT', 'ADMIN_ADJUST_CREDIT'
    description TEXT NOT NULL,
    metadata TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_activities_member_id ON member_activities(member_id);
CREATE INDEX IF NOT EXISTS idx_member_activities_created_at ON member_activities(created_at);
