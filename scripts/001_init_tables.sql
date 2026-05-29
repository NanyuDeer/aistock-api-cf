CREATE TABLE IF NOT EXISTS stocks (
    symbol TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    pinyin TEXT NOT NULL,
    market TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    openid     TEXT PRIMARY KEY,
    nickname   TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_stocks (
    openid     TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (openid, symbol),

    FOREIGN KEY (openid) REFERENCES users(openid)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_stocks_openid
ON user_stocks(openid);

CREATE TABLE IF NOT EXISTS user_settings (
    openid       TEXT NOT NULL,
    setting_type TEXT NOT NULL,
    enabled      INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (openid, setting_type),

    FOREIGN KEY (openid) REFERENCES users(openid)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_settings_type_enabled
ON user_settings(setting_type, enabled);

CREATE TABLE IF NOT EXISTS tags (
    tag_code  TEXT PRIMARY KEY CHECK (tag_code ~ '^BK\d{4}$'),
    tag_name  TEXT NOT NULL,
    tag_type  TEXT NOT NULL CHECK (
        tag_type IN ('概念板块', '地域板块', '行业板块')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_tags (
    symbol     TEXT NOT NULL,
    tag_code   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (symbol, tag_code),

    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    FOREIGN KEY (tag_code) REFERENCES tags(tag_code)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stock_tags_tag_symbol
ON stock_tags(tag_code, symbol);

CREATE INDEX IF NOT EXISTS idx_stock_tags_symbol_tag
ON stock_tags(symbol, tag_code);

CREATE TABLE IF NOT EXISTS news_tags (
    news_id    TEXT NOT NULL CHECK (length(trim(news_id)) > 0),
    tag_code   TEXT NOT NULL,
    effect_type TEXT NOT NULL CHECK (effect_type IN ('利好', '利空')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (news_id, tag_code),

    FOREIGN KEY (tag_code) REFERENCES tags(tag_code)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_news_tags_news_effect_created
ON news_tags(news_id, effect_type, created_at DESC);

CREATE TABLE IF NOT EXISTS stock_analysis (
    symbol        TEXT NOT NULL,
    analysis_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    conclusion    TEXT NOT NULL CHECK (
        conclusion IN ('重大利好', '利好', '中性', '利空', '重大利空')
    ),

    core_logic    TEXT NOT NULL,
    risk_warning  TEXT NOT NULL,

    PRIMARY KEY (symbol, analysis_time),

    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stock_analysis_time
ON stock_analysis(analysis_time);

CREATE TABLE IF NOT EXISTS tenx_scores (
    symbol            TEXT NOT NULL,
    score_date        TEXT NOT NULL,
    score             DOUBLE PRECISION NOT NULL,
    label             TEXT NOT NULL,
    expected_multiple TEXT,
    description       TEXT,
    ai_conclusion     TEXT,
    dim_scores        TEXT,
    indicators        TEXT,
    raw_data          TEXT,
    updated_at        TEXT,

    PRIMARY KEY (symbol, score_date)
);

CREATE INDEX IF NOT EXISTS idx_tenx_scores_symbol
ON tenx_scores(symbol);

CREATE INDEX IF NOT EXISTS idx_tenx_scores_date
ON tenx_scores(score_date DESC);

CREATE TABLE IF NOT EXISTS earnings_forecast (
    symbol               TEXT NOT NULL,
    update_time          TIMESTAMPTZ NOT NULL,

    summary              TEXT,
    forecast_detail      JSONB NOT NULL DEFAULT '[]'::jsonb,
    forecast_netprofit_yoy DOUBLE PRECISION,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (symbol, update_time),

    FOREIGN KEY (symbol) REFERENCES stocks(symbol)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_earnings_forecast_yoy
ON earnings_forecast(forecast_netprofit_yoy DESC);

CREATE TABLE IF NOT EXISTS scan_login_states (
    state      TEXT PRIMARY KEY,
    status     TEXT NOT NULL,
    openid     TEXT,
    jwt        TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_login_expires
ON scan_login_states(expires_at);
