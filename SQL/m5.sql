USE stockboard;                       -- 先切到正確的 DB（可換成你的DB名）
DROP TABLE IF EXISTS `history_prediction`;        -- 建議加 IF EXISTS，避免表不存在時出錯

CREATE TABLE history_prediction (
  symbol    VARCHAR(10) NOT NULL,
  pred_date DATE        NOT NULL,
  day_index TINYINT UNSIGNED NOT NULL,
  dir       ENUM('up','down','flat') NOT NULL,
  PRIMARY KEY (symbol, pred_date)
);

select *from `history_prediction`;
