# 匯入 50 檔台股歷史資料（含技術指標）

import math
from datetime import date
import mysql.connector
from mysql.connector import Error
import pandas as pd
import pandas_ta as ta
import yfinance as yf
import numpy as np

# ======== MySQL 連線設定 ========
MYSQL_CONFIG = dict(
    host="localhost",
    port=3306,
    user="root",
    password="1135j0 wu6b05",  
)
DB_NAME = "stockboard"

# ======== 台股 50 檔代號（TWSE） ========
TW50_SYMBOLS = [
    '2330','2317','2454','2308','2881','2382','2412','2882','2891','3711',
    '2886','2884','2303','1216','2357','6669','2603','2345','2892','2885',
    '2880','5880','6505','3231','2383','3045','3008','2207','3034','3661',
    '2379','1301','1303','1326','2615','2395','2356','2609','2377','2399',
    '8069','3037','5269','2327','2498','2408','3481','2301','2492','3005',
]
# 8069 無資料

# ======== stocks 表結構 ========
TABLE_DDL = """
CREATE DATABASE IF NOT EXISTS `stockboard` DEFAULT CHARACTER SET utf8mb4;
USE `stockboard`;
CREATE TABLE IF NOT EXISTS `stockstw` (
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
"""

INSERT_SQL = """
INSERT INTO `stockstw` (
    `symbol`, `date`, `open`, `high`, `low`, `close`, `volume`,
    `Volume Percentage`, `Sma_5`, `Sma_10`, `Sma_20`, `Sma_60`, `Sma_120`, `Sma_240`,
    `DIF`, `DEA`, `K`, `D`, `J`, `Atr`, `Cci`,
    `Mom_6`, `Mom_10`, `Mom_12`, `Mom_18`,
    `Roc_5`, `Roc_10`, `Roc_12`, `Willr`, `Bias`, `Volume Oscillator`
) VALUES (
    %s, %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s,
    %s, %s, %s, %s, %s, %s
)
ON DUPLICATE KEY UPDATE
    `open`=VALUES(`open`), `high`=VALUES(`high`), `low`=VALUES(`low`),
    `close`=VALUES(`close`), `volume`=VALUES(`volume`),
    `Volume Percentage`=VALUES(`Volume Percentage`),
    `Sma_5`=VALUES(`Sma_5`), `Sma_10`=VALUES(`Sma_10`), `Sma_20`=VALUES(`Sma_20`),
    `Sma_60`=VALUES(`Sma_60`), `Sma_120`=VALUES(`Sma_120`), `Sma_240`=VALUES(`Sma_240`),
    `DIF`=VALUES(`DIF`), `DEA`=VALUES(`DEA`),
    `K`=VALUES(`K`), `D`=VALUES(`D`), `J`=VALUES(`J`),
    `Atr`=VALUES(`Atr`), `Cci`=VALUES(`Cci`),
    `Mom_6`=VALUES(`Mom_6`), `Mom_10`=VALUES(`Mom_10`), `Mom_12`=VALUES(`Mom_12`), `Mom_18`=VALUES(`Mom_18`),
    `Roc_5`=VALUES(`Roc_5`), `Roc_10`=VALUES(`Roc_10`), `Roc_12`=VALUES(`Roc_12`),
    `Willr`=VALUES(`Willr`), `Bias`=VALUES(`Bias`),
    `Volume Oscillator`=VALUES(`Volume Oscillator`);
"""

def ensure_schema(cur):
    """建立 DB + stocks 表（如果不存在）。"""
    for stmt in [s.strip() for s in TABLE_DDL.split(";") if s.strip()]:
        cur.execute(stmt + ";")


def _clean_scalar(v):
    """把值轉成 MySQL 可接受的純 Python 標量，同時處理 NaN/Inf/NaT。"""
    try:
        if v is None:
            return None
        if pd.isna(v):
            return None
        if isinstance(v, np.generic):
            v = v.item()
        if isinstance(v, float):
            if math.isnan(v) or math.isinf(v):
                return None
        return v
    except Exception:
        return None


def _clean_df(df: pd.DataFrame) -> pd.DataFrame:
    """確保整個 DataFrame 都是 object dtype，NaN/Inf->None，且 NumPy 標量->Python 標量。"""
    if df is None or df.empty:
        return df
    df = df.astype(object)
    df = df.where(pd.notna(df), None)
    for c in df.columns:
        df[c] = df[c].map(_clean_scalar)
    return df


def fetch_and_prepare_tw(symbol_tw: str, start_date: str = "2015-01-01") -> pd.DataFrame:
    """
    symbol_tw: 台股代號（例如 '2330'）
    會用 yfinance 的 '2330.TW' 抓資料，但寫回 DB 的 symbol 會是 '2330'
    """
    yf_symbol = f"{symbol_tw}.TW"
    print(f"抓取 {symbol_tw}（Yahoo: {yf_symbol}），從 {start_date} 之後的資料...")
    hist = yf.Ticker(yf_symbol).history(start=start_date)
    if hist.empty:
        print(f" {symbol_tw} 無資料，跳過")
        return pd.DataFrame()

    # ===== 技術指標計算（跟你美股版完全一樣） =====
    hist["Volume_Percentage"] = hist["Volume"].pct_change() * 100

    hist["Sma_5"] = ta.sma(hist["Close"], length=5)
    hist["Sma_10"] = ta.sma(hist["Close"], length=10)
    hist["Sma_20"] = ta.sma(hist["Close"], length=20)
    hist["Sma_60"] = ta.sma(hist["Close"], length=60)
    hist["Sma_120"] = ta.sma(hist["Close"], length=120)
    hist["Sma_240"] = ta.sma(hist["Close"], length=240)

    macd = ta.macd(hist["Close"])
    hist["DIF"] = macd["MACD_12_26_9"]
    hist["DEA"] = macd["MACDs_12_26_9"]

    stoch = ta.stoch(hist["High"], hist["Low"], hist["Close"])
    hist["K"] = stoch["STOCHk_14_3_3"]
    hist["D"] = stoch["STOCHd_14_3_3"]
    hist["J"] = 3 * hist["K"] - 2 * hist["D"]

    hist["Atr"] = ta.atr(hist["High"], hist["Low"], hist["Close"], length=14)
    hist["Cci"] = ta.cci(hist["High"], hist["Low"], hist["Close"], length=20)

    hist["Mom_6"] = ta.mom(hist["Close"], length=6)
    hist["Mom_10"] = ta.mom(hist["Close"], length=10)
    hist["Mom_12"] = ta.mom(hist["Close"], length=12)
    hist["Mom_18"] = ta.mom(hist["Close"], length=18)

    hist["Roc_5"] = ta.roc(hist["Close"], length=5)
    hist["Roc_10"] = ta.roc(hist["Close"], length=10)
    hist["Roc_12"] = ta.roc(hist["Close"], length=12)

    hist["Willr"] = ta.willr(hist["High"], hist["Low"], hist["Close"], length=14)
    hist["Bias"] = (hist["Close"] - hist["Sma_20"]) / hist["Sma_20"] * 100

    short_ma = hist["Volume"].rolling(window=5).mean()
    long_ma = hist["Volume"].rolling(window=20).mean()
    hist["Volume_Oscillator"] = (short_ma - long_ma) / long_ma * 100

    # ===== 整理欄位 =====
    hist = hist.reset_index()
    hist["date"] = hist["Date"].dt.date

    df = pd.DataFrame({
        "symbol": symbol_tw,          # 注意：存台股代號，不存 .TW
        "date": hist["date"],
        "open": hist["Open"],
        "high": hist["High"],
        "low": hist["Low"],
        "close": hist["Close"],
        "volume": hist["Volume"],
        "Volume Percentage": hist["Volume_Percentage"],
        "Sma_5": hist["Sma_5"],
        "Sma_10": hist["Sma_10"],
        "Sma_20": hist["Sma_20"],
        "Sma_60": hist["Sma_60"],
        "Sma_120": hist["Sma_120"],
        "Sma_240": hist["Sma_240"],
        "DIF": hist["DIF"],
        "DEA": hist["DEA"],
        "K": hist["K"],
        "D": hist["D"],
        "J": hist["J"],
        "Atr": hist["Atr"],
        "Cci": hist["Cci"],
        "Mom_6": hist["Mom_6"],
        "Mom_10": hist["Mom_10"],
        "Mom_12": hist["Mom_12"],
        "Mom_18": hist["Mom_18"],
        "Roc_5": hist["Roc_5"],
        "Roc_10": hist["Roc_10"],
        "Roc_12": hist["Roc_12"],
        "Willr": hist["Willr"],
        "Bias": hist["Bias"],
        "Volume_Oscillator": hist["Volume_Oscillator"],
    })

    df = _clean_df(df)
    return df


def batch_insert(cur, df: pd.DataFrame, batch_size: int = 1000):
    if df is None or df.empty:
        return

    df = _clean_df(df)

    cols_in_order = [
        "symbol","date","open","high","low","close","volume",
        "Volume Percentage","Sma_5","Sma_10","Sma_20","Sma_60","Sma_120","Sma_240",
        "DIF","DEA","K","D","J","Atr","Cci",
        "Mom_6","Mom_10","Mom_12","Mom_18",
        "Roc_5","Roc_10","Roc_12","Willr","Bias","Volume_Oscillator"
    ]

    records = []
    for i in df.index:
        row = [df.loc[i, c] for c in cols_in_order]
        row = [_clean_scalar(v) for v in row]
        records.append(tuple(row))

    for i in range(0, len(records), batch_size):
        cur.executemany(INSERT_SQL, records[i:i+batch_size])


def main():
    conn = None
    try:
        conn = mysql.connector.connect(**MYSQL_CONFIG)
        conn.autocommit = False
        cur = conn.cursor()

        ensure_schema(cur)
        conn.commit()
        print(" 已確認/建立 stocks 資料表")

        cur.execute("USE `stockboard`;")

        start_date = "2015-01-01"  # 想縮短可以改成比較新的日期
        for symbol_tw in TW50_SYMBOLS:
            df = fetch_and_prepare_tw(symbol_tw, start_date=start_date)
            if df.empty:
                continue
            batch_insert(cur, df, batch_size=1000)
            conn.commit()
            print(f" {symbol_tw} 寫入完成（{len(df)} 筆）")

    except Error as e:
        if conn:
            conn.rollback()
        print("MySQL 錯誤：", e)
    finally:
        try:
            cur.close()
        except Exception:
            pass
        if conn and conn.is_connected():
            conn.close()
        print(" 已關閉 MySQL 連線")


if __name__ == "__main__":
    main()
