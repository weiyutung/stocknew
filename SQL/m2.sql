USE `stockboard`;
DROP TABLE IF EXISTS `stocks_meta`;
CREATE TABLE stocks_meta (
    symbol VARCHAR(10) PRIMARY KEY,      -- 主要股票代號 (美股代號或ADR代號), 設定為主鍵
    name_en VARCHAR(255) NOT NULL,       -- 英文全名, 不可為空
    name_zh VARCHAR(255) NOT NULL,       -- 中文全名, 不可為空
    short_name_en VARCHAR(255),          -- 英文簡稱, 可為空
    short_name_zh VARCHAR(255),          -- 中文簡稱, 可為空
    twse_symbol VARCHAR(10)              -- 台灣證券交易所代號, 可為空 (對於美股公司為NULL)
);
