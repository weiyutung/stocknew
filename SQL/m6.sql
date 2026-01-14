USE stockboard;                       -- 先切到正確的 DB（可換成你的DB名）
DROP TABLE IF EXISTS `future_prediction`;        -- 建議加 IF EXISTS，避免表不存在時出錯

CREATE TABLE future_prediction (
  symbol    VARCHAR(10) NOT NULL,
  pred_date DATE        NOT NULL,
  day_index TINYINT UNSIGNED NOT NULL,
  dir       ENUM('up','down','flat') NOT NULL,
  PRIMARY KEY (symbol, pred_date)
);

select *from `future_prediction`;


-- CREATE TABLE future_prediction (
--     id INT AUTO_INCREMENT PRIMARY KEY,
--     symbol VARCHAR(20) NOT NULL,
--     base_date DATE NOT NULL, 
--     base_close DECIMAL(10,4) NOT NULL,

--     pred_json JSON NOT NULL,
--     cumulative_json JSON NOT NULL,

--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     UNIQUE(symbol, base_date)
-- );

-- 每一列 = 某檔股票在某一天的預測方向
-- symbol    股票代碼
-- pred_date 預測日期（= base_date + day_index）
-- day_index 第幾天(1~30)
-- dir       'up' / 'down' / 'flat'


