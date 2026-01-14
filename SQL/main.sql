USE `stockboard`;

CREATE TABLE stocks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    open DOUBLE,
    high DOUBLE,
    low DOUBLE,
    close DOUBLE,
    volume BIGINT,

    `Volume Percentage` DOUBLE,
    `Sma_5` DOUBLE,
    `Sma_10` DOUBLE,
    `Sma_20` DOUBLE,
    `Sma_60` DOUBLE,
    `Sma_120` DOUBLE,
    `Sma_240` DOUBLE,

    `DIF` DOUBLE,
    `DEA` DOUBLE,
    `K` DOUBLE,
    `D` DOUBLE,
    `J` DOUBLE,
    `Atr` DOUBLE,
    `Cci` DOUBLE,

    `Mom_6` DOUBLE,
    `Mom_10` DOUBLE,
    `Mom_12` DOUBLE,
    `Mom_18` DOUBLE,

    `Roc_5` DOUBLE,
    `Roc_10` DOUBLE,
    `Roc_12` DOUBLE,
    `Willr` DOUBLE,
    `Bias` DOUBLE,
    `Volume Oscillator` DOUBLE,

    UNIQUE(symbol, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
