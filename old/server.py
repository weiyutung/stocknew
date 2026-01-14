# server.py
# pip install fastapi uvicorn "mysql-connector-python" "python-multipart" "pydantic<2" "uvicorn[standard]"
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import mysql.connector
from datetime import date

app = FastAPI(title="StockBoard API")

# 允許本機前端呼叫
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

DB = dict(host="localhost", port=3306, user="root", password="1135j0 wu6b05", database="stockboard")

def get_conn():
    return mysql.connector.connect(**DB)

# 依你現有 MySQL 欄位，使用 SQL 別名把底層的 Sma_5 → 輸出成 "Sma 5"（前端不用重改）
SELECT_COLUMNS = """
symbol, date, open, high, low, close, volume,
`Volume Percentage`,
`Sma_5`  AS `Sma 5`,
`Sma_10` AS `Sma 10`,
`Sma_20` AS `Sma 20`,
`Sma_60` AS `Sma 60`,
`Sma_120` AS `Sma 120`,
`Sma_240` AS `Sma 240`,
`DIF`, `DEA`, `K`, `D`, `J`, `Atr`, `Cci`,
`Mom_6` AS `Mom 6`,
`Mom_10` AS `Mom 10`,
`Mom_12` AS `Mom 12`,
`Mom_18` AS `Mom 18`,
`Roc_5` AS `Roc 5`,
`Roc_10` AS `Roc 10`,
`Roc_12` AS `Roc 12`,
`Willr`, `Bias`,
`Volume Oscillator`
"""

@app.get("/api/stocks")
def get_stocks(symbol: str = Query(...), count: int = Query(264, ge=1, le=2000)):
    q = f"""
      SELECT {SELECT_COLUMNS}
      FROM stocks
      WHERE symbol = %s
      ORDER BY date DESC
      LIMIT %s
    """
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute(q, (symbol, count))
        rows = cur.fetchall()
    # 前端原本是由新到舊取完再 sort 回舊→新，這裡幫你排好舊→新，前端就不用再 sort
    rows.reverse()
    return rows

@app.get("/api/stocks/range")
def get_stocks_range(
    symbol: str = Query(...),
    start: date = Query(...),
    end: date = Query(...)
):
    q = f"""
      SELECT {SELECT_COLUMNS}
      FROM stocks
      WHERE symbol = %s AND date BETWEEN %s AND %s
      ORDER BY date ASC
    """
    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute(q, (symbol, start, end))
        rows = cur.fetchall()
    return rows

@app.get("/api/suggest")
def suggest(q: str = Query(...), limit: int = 10):
    # 若你有 stocks_meta 就用它；沒有就從 stocks 抓 distinct symbol
    try_meta = """
      SELECT symbol,
             COALESCE(name_zh, name_en, short_name_zh, short_name_en, '') AS name
      FROM stocks_meta
      WHERE symbol LIKE %s OR name_en LIKE %s OR name_zh LIKE %s
         OR short_name_en LIKE %s OR short_name_zh LIKE %s
      GROUP BY symbol, name
      LIMIT %s
    """
    params = tuple([f"%{q}%"]*5) + (limit,)

    with get_conn() as conn:
        cur = conn.cursor(dictionary=True)
        try:
            cur.execute(try_meta, params)
            rows = cur.fetchall()
            if rows:
                return rows
        except mysql.connector.Error:
            pass
        # 後備：distinct symbol
        cur.execute(
            "SELECT DISTINCT symbol, '' AS name FROM stocks WHERE symbol LIKE %s LIMIT %s",
            (f"%{q}%", limit),
        )
        return cur.fetchall()
